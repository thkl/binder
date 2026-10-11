import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { SSOAuthenticationService } from '../service/ssoauthentication.service';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { SessionRequest } from '../models/request.model';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { AuthenticationService } from '../service/authentication.service';
import { ConfigService } from '@nestjs/config';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { NativeSSOAuthCodeStore } from '../stores/native-sso-auth-code.store';

@Controller('ssoauth')
export class AuthenticationController {
  private readonly logger = new Logger(AuthenticationController.name);

  constructor(
    private readonly ssoAuthenticationService: SSOAuthenticationService,
    private readonly settingsService: ApplicationSettingsService,
    private readonly appConfig: ConfigService<BinderConfig>,
    private readonly authenticationService: AuthenticationService,
    private readonly nativeSSOAuthCodes: NativeSSOAuthCodeStore,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Get('active')
  async isActive() {
    const isActive = await this.ssoAuthenticationService.isActive();
    return { data: { isActive } };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Get('login')
  async login(@Req() request: SessionRequest, @Res() res: Response) {
    const rootUri = this.appConfig.get<string>(ConfigKeys.ROOT_URI);
    if (rootUri?.startsWith('https://') && !request.secure) {
      // express-session intentionally suppresses Secure cookies on requests
      // Express does not recognize as HTTPS. Include only proxy diagnostics,
      // never session identifiers or OIDC secrets, to make that failure clear.
      this.logger.warn(
        `HTTPS ROOT_URI but SSO request is not secure (peer=${request.socket.remoteAddress ?? 'unknown'}, protocol=${request.protocol}, x-forwarded-proto=${request.get('x-forwarded-proto') ?? 'missing'}); check TRUST_PROXY and proxy headers`,
      );
    }
    const ssodata = await this.ssoAuthenticationService.getAuthorizationUrl();
    if (ssodata) {
      // Use a fresh session so logout or stale browser cookies cannot carry an
      // earlier OIDC transaction into this login attempt.
      await this.prepareOidcSession(request, ssodata.state, ssodata.code_verifier);

      return res.redirect(ssodata.url);
    } else {
      throw new HttpException('SSO is not configured', 400);
    }
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Get('native/login')
  async nativeLogin(
    @Req() request: SessionRequest,
    @Res() res: Response,
    @Query('state') state: string,
    @Query('code_challenge') codeChallenge: string,
  ) {
    if (
      !/^[A-Za-z0-9_-]{43,128}$/.test(state ?? '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge ?? '')
    ) {
      throw new BadRequestException('Invalid native SSO state or PKCE challenge');
    }
    const ssodata = await this.ssoAuthenticationService.getAuthorizationUrl();
    if (!ssodata) throw new HttpException('SSO is not configured', 400);
    await this.prepareOidcSession(
      request,
      ssodata.state,
      ssodata.code_verifier,
      state,
      codeChallenge,
    );
    return res.redirect(ssodata.url);
  }

  /**
   * Starts a new, persisted session for a single OIDC authorization transaction.
   *
   * @param {SessionRequest} request - Browser or native-app login request.
   * @param {string} state - OIDC state value to validate on callback.
   * @param {string} codeVerifier - PKCE verifier used to redeem the callback code.
   * @param {string} [nativeAppState] - Optional app state returned to the native caller.
   * @param {string} [nativeCodeChallenge] - Optional native-app PKCE challenge.
   * @returns {Promise<void>} Resolves after the new session is stored.
   */
  private async prepareOidcSession(
    request: SessionRequest,
    state: string,
    codeVerifier: string,
    nativeAppState?: string,
    nativeCodeChallenge?: string,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    request.session.oidcState = state;
    request.session.oidcCodeVerifier = codeVerifier;
    if (nativeAppState && nativeCodeChallenge) {
      request.session.nativeAppState = nativeAppState;
      request.session.nativeCodeChallenge = nativeCodeChallenge;
    }
    await this.saveSession(request);
  }

  /**
   * Waits for express-session to persist the current login transaction.
   *
   * @param {SessionRequest} request - Request containing the current session.
   * @returns {Promise<void>} Resolves after the session is stored.
   */
  private async saveSession(request: SessionRequest): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      request.session.save((error) => (error ? reject(error) : resolve()));
    });
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Get('/callback')
  async callback(@Req() request: SessionRequest, @Res() res: Response) {
    const expectedState = request.session.oidcState;
    const codeVerifier = request.session.oidcCodeVerifier;
    const nativeAppState = request.session.nativeAppState;
    const nativeCodeChallenge = request.session.nativeCodeChallenge;

    if (!expectedState || !codeVerifier) {
      throw new BadRequestException('Invalid or expired OIDC session state');
    }

    delete request.session.oidcState;
    delete request.session.oidcCodeVerifier;
    delete request.session.nativeAppState;
    delete request.session.nativeCodeChallenge;

    // Build the full current callback URL from express request
    const currentUrl = new URL(request.originalUrl, `${request.protocol}://${request.get('host')}`);

    // Validate callback & parse claims
    const oidcUser = await this.ssoAuthenticationService.handleCallback(
      currentUrl,
      expectedState,
      codeVerifier,
    );

    if (oidcUser && oidcUser.email) {
      const result = await this.authenticationService.validateSSOUser(oidcUser.email);
      if (nativeAppState && nativeCodeChallenge) {
        if (!result.user.uuid) throw new UnauthorizedException('SSO user is no longer available');
        const code = await this.nativeSSOAuthCodes.issue(
          result.user.uuid,
          nativeCodeChallenge,
          nativeAppState,
        );
        const callbackUrl = new URL('com.binder.ios://sso/callback');
        callbackUrl.searchParams.set('code', code);
        callbackUrl.searchParams.set('state', nativeAppState);
        return res.redirect(callbackUrl.toString());
      }
      // Normal login (no 2FA or 2FA not enabled)
      await new Promise<void>((resolve, reject) => {
        request.session.regenerate((error) => (error ? reject(error) : resolve()));
      });
      request.session.userId = result.user.uuid;
      await new Promise<void>((resolve, reject) => {
        request.session.save((error) => (error ? reject(error) : resolve()));
      });

      const rootUrl = this.appConfig.get<string>(ConfigKeys.ROOT_URI);

      if (!rootUrl) {
        throw new HttpException('ROOT_URI not set', 500);
      }
      return res.redirect(rootUrl);
    }
  }
}
