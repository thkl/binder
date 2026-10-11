import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { FileProvider, FileProviderEntry } from './file-provider.js';

const DROPBOX_CONTENT_URL = 'https://content.dropboxapi.com/2';
const DROPBOX_API_URL = 'https://api.dropboxapi.com/2';
const CHUNK_SIZE = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

interface DropboxTokenResponse {
  access_token?: string;
}

interface DropboxListFolderResponse {
  entries?: Array<{
    '.tag'?: string;
    path_display?: string;
    server_modified?: string;
  }>;
  has_more?: boolean;
  cursor?: string;
}

export class DropboxFileProvider extends FileProvider {
  /**
   * Creates a Dropbox adapter using either refresh-token credentials or a one-time access token.
   *
   * @param {string | null} refreshToken - OAuth refresh token for the remote provider.
   * @param {string | null} appKey - Dropbox application key.
   * @param {string | null} appSecret - Dropbox application secret.
   * @param {string} oneTimeAccessToken - Short-lived access token used for this operation.
   */
  constructor(
    private readonly refreshToken: string | null,
    private readonly appKey: string | null,
    private readonly appSecret: string | null,
    private readonly oneTimeAccessToken?: string,
  ) {
    super();
  }

  /**
   * Uploads a file, using Dropbox upload sessions when it exceeds the single-request limit.
   *
   * @param {string} localPath - Local filesystem path used for the file operation.
   * @param {string} remotePath - Path of the file in remote storage.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async storeFile(localPath: string, remotePath: string): Promise<void> {
    const accessToken = await this.accessToken();
    const stats = await fs.stat(localPath);
    const file = await fs.open(localPath, 'r');
    try {
      if (stats.size <= CHUNK_SIZE) {
        const body = await file.readFile();
        await this.request('files/upload', accessToken, body, {
          path: remotePath,
          mode: 'add',
          autorename: false,
          mute: true,
        });
        return;
      }

      const first = Buffer.alloc(CHUNK_SIZE);
      const firstRead = await file.read(first, 0, first.length, 0);
      const started = await this.request(
        'files/upload_session/start',
        accessToken,
        first.subarray(0, firstRead.bytesRead),
        { close: false },
      );
      const sessionId = String(started.session_id);
      let offset = firstRead.bytesRead;

      // Dropbox requires each chunk to advance the session cursor; the final
      // chunk commits the remote file instead of using the append endpoint.
      while (offset < stats.size) {
        const length = Math.min(CHUNK_SIZE, stats.size - offset);
        const chunk = Buffer.alloc(length);
        const read = await file.read(chunk, 0, length, offset);
        const last = offset + read.bytesRead >= stats.size;
        const endpoint = last ? 'files/upload_session/finish' : 'files/upload_session/append_v2';
        const argument = last
          ? {
              cursor: { session_id: sessionId, offset },
              commit: { path: remotePath, mode: 'add', autorename: false, mute: true },
            }
          : { cursor: { session_id: sessionId, offset }, close: false };
        await this.request(endpoint, accessToken, chunk.subarray(0, read.bytesRead), argument);
        offset += read.bytesRead;
      }
    } finally {
      await file.close();
    }
  }

  /**
   * Downloads a remote Dropbox file to the requested local path.
   *
   * @param {string} remotePath - Path of the file in remote storage.
   * @param {string} localPath - Local filesystem path used for the file operation.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async readFile(remotePath: string, localPath: string): Promise<void> {
    const accessToken = await this.accessToken();
    const response = await fetch(`${DROPBOX_CONTENT_URL}/files/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: remotePath }),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      const details = await response.text();
      throw new Error(
        `Dropbox download failed with HTTP ${response.status}: ${details.slice(0, 500)}`,
      );
    }
    const output = createWriteStream(localPath, { mode: 0o660 });
    for await (const chunk of response.body) output.write(chunk);
    output.end();
    await new Promise<void>((resolve, reject) => {
      output.once('finish', resolve);
      output.once('error', reject);
    });
  }

  /**
   * Deletes a remote Dropbox file and treats a missing path as already deleted.
   *
   * @param {string} remotePath - Path of the file in remote storage.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async deleteFile(remotePath: string): Promise<void> {
    const accessToken = await this.accessToken();
    await this.request('files/delete_v2', accessToken, undefined, { path: remotePath });
  }

  /**
   * Lists file entries in a Dropbox folder, following all cursor-based result pages.
   *
   * @param {string} remoteFolder - Remote folder path to list or use as the backup destination.
   * @returns {Promise<FileProviderEntry[]>} - Lists file entries in a Dropbox folder, following all cursor-based result pages.
   */
  async listFiles(remoteFolder: string): Promise<FileProviderEntry[]> {
    const accessToken = await this.accessToken();
    const entries: FileProviderEntry[] = [];
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `${DROPBOX_API_URL}/files/${cursor ? 'list_folder/continue' : 'list_folder'}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            cursor
              ? { cursor }
              : {
                  path: remoteFolder === '/' ? '' : remoteFolder.replace(/\/$/, ''),
                  recursive: false,
                },
          ),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        const details = await response.text();
        throw new Error(
          `Dropbox list operation failed with HTTP ${response.status}: ${details.slice(0, 500)}`,
        );
      }
      const page = (await response.json()) as DropboxListFolderResponse;
      for (const entry of page.entries ?? []) {
        if (entry['.tag'] !== 'file' || !entry.path_display || !entry.server_modified) continue;
        entries.push({ path: entry.path_display, modifiedAt: new Date(entry.server_modified) });
      }
      hasMore = page.has_more === true;
      cursor = page.cursor;
    }

    return entries;
  }

  private async accessToken(): Promise<string> {
    if (this.oneTimeAccessToken) return this.oneTimeAccessToken;
    if (!this.refreshToken || !this.appKey || !this.appSecret) {
      throw new Error('Dropbox credentials are incomplete');
    }
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.appKey,
        client_secret: this.appSecret,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `Dropbox token refresh failed with HTTP ${response.status}: ${details.slice(0, 500)}`,
      );
    }
    const data = (await response.json()) as DropboxTokenResponse;
    if (!data.access_token) throw new Error('Dropbox token refresh returned no access token');
    return data.access_token;
  }

  private async request(
    endpoint: string,
    accessToken: string,
    body: Uint8Array | undefined,
    argument: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${DROPBOX_CONTENT_URL}/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify(argument),
      },
      body: body ? Buffer.from(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const details = await response.text();
      const missingScope = this.missingScope(details);
      throw new Error(
        missingScope
          ? `Dropbox authorization is missing the ${missingScope} scope. Enable it in the Dropbox App Console and reconnect Dropbox.`
          : `Dropbox file operation failed with HTTP ${response.status}: ${details.slice(0, 500)}`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private missingScope(details: string): string | null {
    try {
      const parsed = JSON.parse(details) as {
        error?: { '.tag'?: string; required_scope?: string };
      };
      return parsed.error?.['.tag'] === 'missing_scope'
        ? (parsed.error.required_scope ?? 'required Dropbox file access')
        : null;
    } catch {
      return null;
    }
  }
}
