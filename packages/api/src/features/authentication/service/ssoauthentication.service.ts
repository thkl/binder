// oidc.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  discovery,
  randomState,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  Configuration,
} from 'openid-client';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';

@Injectable()
export class SSOAuthenticationService {
  private config!: Configuration;

  constructor(
    private readonly settingsService: ApplicationSettingsService,

    private readonly appConfig: ConfigService<BinderConfig>,
  ) {}

  @OnEvent('database.connected')
  async initialize(): Promise<boolean> {
    if (this.config) {
      return true;
    }

    const OIDC_ISSUER_URL = await this.settingsService.get('oidc.ISSUER_URL');
    const OIDC_CLIENT_ID = await this.settingsService.get('oidc.CLIENT_ID');
    const OIDC_CLIENT_SECRET = await this.settingsService.get('oidc.CLIENT_SECRET');

    if (!OIDC_ISSUER_URL || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) {
      return false;
    }
    // Dynamic discovery fetches endpoints (auth, token, keys) automatically
    const issuerUrl = new URL(OIDC_ISSUER_URL); // e.g., 'https://accounts.google.com'

    this.config = await discovery(issuerUrl, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET);
    return true;
  }

  async isActive(): Promise<boolean> {
    return this.config !== undefined;
  }

  async validateConfiguration(): Promise<boolean> {
    const issuerUrl = await this.settingsService.get('oidc.ISSUER_URL');
    const clientId = await this.settingsService.get('oidc.CLIENT_ID');
    const clientSecret = await this.settingsService.get('oidc.CLIENT_SECRET');

    if (!issuerUrl || !clientId || !clientSecret) {
      return false;
    }

    const issuer = new URL(issuerUrl);
    this.config = await discovery(issuer, clientId, clientSecret);
    return true;
  }

  // 1. Build redirect authorization URL with PKCE + state checks
  async getAuthorizationUrl() {
    if (!(await this.initialize())) {
      return;
    }
    const rootUrl = this.appConfig.get<string>(ConfigKeys.ROOT_URI);
    const redirect_uri = `${rootUrl}/api/v1/ssoauth/callback`;
    if (!redirect_uri) {
      return;
    }
    // Generate secure state & code verifier for PKCE

    const state = randomState();

    const code_verifier = randomPKCECodeVerifier();
    const code_challenge = await calculatePKCECodeChallenge(code_verifier);
    const acrValues = await this.settingsService.get('oidc.ACR_VALUES');
    const url = buildAuthorizationUrl(this.config, {
      redirect_uri,
      scope: 'openid profile email',
      ...(acrValues ? { acr_values: acrValues } : {}),
      state,
      code_challenge,
      code_challenge_method: 'S256',
    });

    return {
      url: url.href,

      state,

      code_verifier,
    };
  }

  // 2. Process callback and validate tokens
  async handleCallback(currentUrl: URL, expectedState: string, codeVerifier: string) {
    if (!(await this.initialize())) {
      throw new Error('SSO is not configured');
    }
    const tokens = await authorizationCodeGrant(this.config, currentUrl, {
      expectedState,
      pkceCodeVerifier: codeVerifier,
    });

    // Extract verified claims from the ID token payload
    const claims = tokens.claims();
    const requireEmailVerified = await this.settingsService.get('oidc.email_verified');
    const mustUseEmailVerified =
      requireEmailVerified?.toLowerCase() === 'true' || requireEmailVerified === '1';

    if (mustUseEmailVerified && (claims === undefined || claims.email_verified !== true)) {
      throw new Error('email_verified not set in claims');
    }

    return {
      ssoId: claims?.sub,
      email: claims?.email as string,
      firstName: claims?.given_name as string,
      lastName: claims?.family_name as string,
    };
  }
}
