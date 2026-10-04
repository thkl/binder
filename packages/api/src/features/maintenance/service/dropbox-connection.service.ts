import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { SessionRequest } from '../../authentication/models/request.model';

interface DropboxTokenResponse {
  refresh_token?: string;
}

@Injectable()
export class DropboxConnectionService {
  constructor(
    private readonly settings: ApplicationSettingsService,
    private readonly config: ConfigService<BinderConfig>,
  ) {}

  async status(): Promise<{ provider: string; connected: boolean; configured: boolean }> {
    return {
      provider: (await this.settings.get('backup.provider', 'none')) ?? 'none',
      connected: Boolean(await this.settings.get('backup.dropbox.refreshToken')),
      configured: Boolean(this.appKey() && this.appSecret() && this.redirectUri()),
    };
  }

  authorize(request: SessionRequest, response: Response): void {
    const appKey = this.appKey();
    if (!appKey || !this.appSecret()) {
      throw new BadRequestException('Dropbox OAuth is not configured on the server');
    }
    const state = randomBytes(24).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    request.session.dropboxState = state;
    request.session.dropboxCodeVerifier = verifier;
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
    if (!verifier || !this.appKey() || !this.appSecret()) {
      throw new BadRequestException('Dropbox OAuth is not configured on the server');
    }
    const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: this.appKey()!,
        client_secret: this.appSecret()!,
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
    response.redirect(`${rootUri.replace(/\/$/, '')}/settings/maintenance?dropbox=connected`);
  }

  async disconnect(): Promise<void> {
    await this.settings.delete('backup.dropbox.refreshToken');
    await this.settings.set('backup.provider', 'none');
  }

  private appKey(): string | undefined {
    return this.config.get<string>(ConfigKeys.DROPBOX_APP_KEY);
  }
  private appSecret(): string | undefined {
    return this.config.get<string>(ConfigKeys.DROPBOX_APP_SECRET);
  }
  private redirectUri(): string {
    return `${this.config.get<string>(ConfigKeys.ROOT_URI)}/${this.config.get<string>(ConfigKeys.API_PREFIX) ?? 'api/v1'}/maintenance/dropbox/callback`;
  }
}
