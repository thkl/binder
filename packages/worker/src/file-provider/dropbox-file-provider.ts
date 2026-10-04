import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { FileProvider } from './file-provider.js';

const DROPBOX_CONTENT_URL = 'https://content.dropboxapi.com/2';
const CHUNK_SIZE = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

interface DropboxTokenResponse {
  access_token?: string;
}

export class DropboxFileProvider extends FileProvider {
  constructor(
    private readonly refreshToken: string,
    private readonly appKey: string,
    private readonly appSecret: string,
  ) {
    super();
  }

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

  async deleteFile(remotePath: string): Promise<void> {
    const accessToken = await this.accessToken();
    await this.request('files/delete_v2', accessToken, undefined, { path: remotePath });
  }

  private async accessToken(): Promise<string> {
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
      throw new Error(
        `Dropbox file operation failed with HTTP ${response.status}: ${details.slice(0, 500)}`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
