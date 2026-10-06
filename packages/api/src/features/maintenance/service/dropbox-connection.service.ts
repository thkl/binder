import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { SessionRequest } from '../../authentication/models/request.model';
import { SecretsService } from '../../../shared/config/secrets.service';
import {
  RecoveryBackup,
  RecoveryBackupListResponse,
  RecoveryBackupListResponseSchema,
} from '@binder/common';

interface DropboxTokenResponse {
  access_token?: string;
  refresh_token?: string;
}

@Injectable()
export class DropboxConnectionService {
  constructor(
    private readonly settings: ApplicationSettingsService,
    private readonly config: ConfigService<BinderConfig>,
    private readonly secrets: SecretsService,
  ) {}

  async status(): Promise<{ provider: string; connected: boolean; configured: boolean }> {
    const [appKey, appSecret] = await Promise.all([this.appKey(), this.appSecret()]);
    return {
      provider: (await this.settings.get('backup.provider', 'none')) ?? 'none',
      connected: Boolean(await this.settings.get('backup.dropbox.refreshToken')),
      configured: Boolean(appKey && appSecret),
    };
  }

  async authorize(request: SessionRequest, response: Response, returnTo?: string): Promise<void> {
    const [appKey, appSecret] = await Promise.all([this.appKey(), this.appSecret()]);
    if (!appKey || !appSecret) {
      throw new BadRequestException('Dropbox OAuth is not configured on the server');
    }
    const state = randomBytes(24).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    request.session.dropboxState = state;
    request.session.dropboxCodeVerifier = verifier;
    request.session.dropboxReturnTo = returnTo === '/' ? '/' : '/settings/maintenance';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: appKey,
      response_type: 'code',
      token_access_type: 'offline',
      redirect_uri: this.redirectUri(),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    response.redirect(url.toString());
  }

  async callback(request: SessionRequest, response: Response): Promise<void> {
    const state = request.query.state;
    const code = request.query.code;
    if (
      typeof state !== 'string' ||
      state !== request.session.dropboxState ||
      typeof code !== 'string'
    ) {
      throw new BadRequestException('Invalid or expired Dropbox OAuth state');
    }
    const verifier = request.session.dropboxCodeVerifier;
    delete request.session.dropboxState;
    delete request.session.dropboxCodeVerifier;
    const returnTo = request.session.dropboxReturnTo ?? '/settings/maintenance';
    delete request.session.dropboxReturnTo;
    const [appKey, appSecret] = await Promise.all([this.appKey(), this.appSecret()]);
    if (!verifier || !appKey || !appSecret) {
      throw new BadRequestException('Dropbox OAuth is not configured on the server');
    }
    const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: appKey,
        client_secret: appSecret,
        redirect_uri: this.redirectUri(),
        code_verifier: verifier,
      }),
    });
    if (!tokenResponse.ok)
      throw new BadRequestException('Dropbox authorization could not be completed');
    const token = (await tokenResponse.json()) as DropboxTokenResponse;
    if (!token.refresh_token)
      throw new BadRequestException('Dropbox did not return a refresh token');
    await this.settings.set('backup.dropbox.refreshToken', token.refresh_token, true);
    await this.settings.set('backup.provider', 'dropbox');
    const rootUri = this.config.get<string>(ConfigKeys.ROOT_URI) ?? '/';
    response.redirect(`${rootUri.replace(/\/$/, '')}${returnTo}?dropbox=connected`);
  }

  async listRecoveryBackups(
    oneTimeAccessToken?: string,
    recoveryFolder?: string,
  ): Promise<RecoveryBackupListResponse> {
    const status = await this.status();
    const accessTokenOverride = oneTimeAccessToken?.trim();
    if (!accessTokenOverride && (!status.configured || !status.connected)) {
      return RecoveryBackupListResponseSchema.parse({ ...status, backups: [] });
    }

    const configuredFolder = await this.settings.get('backup.remoteFolder', '/Binder backups');
    const remoteFolder =
      recoveryFolder?.trim() ||
      (oneTimeAccessToken ? '/' : configuredFolder?.trim()) ||
      '/Binder backups';
    const accessToken = accessTokenOverride ?? (await this.accessToken());
    const entries: RecoveryBackup[] = [];
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `https://api.dropboxapi.com/2/files/${cursor ? 'list_folder/continue' : 'list_folder'}`,
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
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) {
        const details = await response.text();
        if (response.status === 409 && details.includes('path/not_found')) {
          throw new BadRequestException(
            `Dropbox backup folder was not found: ${remoteFolder}. For a Dropbox App-folder application, use /; otherwise enter the folder containing the Binder backups.`,
          );
        }
        throw new BadRequestException(
          `Dropbox backup listing failed with HTTP ${response.status}: ${details.slice(0, 300)}`,
        );
      }
      const page = (await response.json()) as {
        entries?: Array<{
          '.tag'?: string;
          name?: string;
          server_modified?: string;
          size?: number;
        }>;
        has_more?: boolean;
        cursor?: string;
      };
      for (const entry of page.entries ?? []) {
        if (
          entry['.tag'] !== 'file' ||
          !entry.name ||
          !/^binder-\d{8}-\d{6}\.tar\.gz\.age$/.test(entry.name) ||
          !entry.server_modified
        )
          continue;
        const timestamp = entry.name.match(/^binder-(\d{8})-(\d{6})\.tar\.gz\.age$/);
        if (!timestamp) continue;
        const [, date, time] = timestamp;
        const createdAt = new Date(
          `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`,
        );
        entries.push({
          filename: entry.name,
          createdAt: createdAt.toISOString(),
          scope: 'full',
          sizeBytes: Number(entry.size ?? 0),
        });
      }
      hasMore = page.has_more === true;
      cursor = page.cursor;
    }

    return RecoveryBackupListResponseSchema.parse({
      ...status,
      connected: Boolean(accessTokenOverride) || status.connected,
      backups: entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  }

  async disconnect(): Promise<void> {
    await this.settings.delete('backup.dropbox.refreshToken');
    await this.settings.set('backup.provider', 'none');
  }

  private async appKey(): Promise<string | undefined> {
    return this.secrets.get(ConfigKeys.DROPBOX_APP_KEY);
  }
  private async appSecret(): Promise<string | undefined> {
    return this.secrets.get(ConfigKeys.DROPBOX_APP_SECRET);
  }

  private async accessToken(): Promise<string> {
    const [refreshToken, appKey, appSecret] = await Promise.all([
      this.settings.get('backup.dropbox.refreshToken'),
      this.appKey(),
      this.appSecret(),
    ]);
    if (!refreshToken || !appKey || !appSecret) {
      throw new BadRequestException(
        'Dropbox is connected but its OAuth configuration is incomplete',
      );
    }
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: appKey,
        client_secret: appSecret,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new BadRequestException('Dropbox access could not be refreshed');
    const token = (await response.json()) as DropboxTokenResponse;
    if (!token.access_token) throw new BadRequestException('Dropbox returned no access token');
    return token.access_token;
  }
  private redirectUri(): string {
    return `${this.config.get<string>(ConfigKeys.ROOT_URI)}/${this.config.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1'}/maintenance/dropbox/callback`;
  }
}
