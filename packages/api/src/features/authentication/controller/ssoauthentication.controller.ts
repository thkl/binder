import { BadRequestException, Body, Controller, Get, HttpException, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { SSOAuthenticationService } from '../service/ssoauthentication.service';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { SessionRequest } from '../models/request.model';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { AuthenticationService } from '../service/authentication.service';

@Controller('ssoauth')
export class AuthenticationController {
    constructor(
        private readonly ssoAuthenticationService: SSOAuthenticationService,
        private readonly settingsService: ApplicationSettingsService,
        private readonly authenticationService: AuthenticationService) { }

    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Get('active')
    async isActive() {
        const isActive = await this.ssoAuthenticationService.isActive();
        return { data: {isActive} };
    }


    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Get('login')
    async login(@Req() request: SessionRequest, @Res() res: Response) {
        const ssodata = await this.ssoAuthenticationService.getAuthorizationUrl();
        if (ssodata) {
            // Store the short-lived OIDC values in the authenticated session.
            request.session.oidcState = ssodata.state;
            request.session.oidcCodeVerifier = ssodata.code_verifier;

            return res.redirect(ssodata.url);
        } else {
            throw new HttpException('SSO is not configured', 400);
        }
    }

    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @Get('/callback')
    async callback(@Req() request: SessionRequest, @Res() res: Response) {
        const expectedState = request.session.oidcState;
        const codeVerifier = request.session.oidcCodeVerifier;

        if (!expectedState || !codeVerifier) {
            throw new BadRequestException('Invalid or expired OIDC session state');
        }

        delete request.session.oidcState;
        delete request.session.oidcCodeVerifier;

        // Build the full current callback URL from express request
        const currentUrl = new URL(
            request.originalUrl,
            `${request.protocol}://${request.get('host')}`,
        );

        // Validate callback & parse claims
        const oidcUser = await this.ssoAuthenticationService.handleCallback(
            currentUrl,
            expectedState,
            codeVerifier,
        );

        if (oidcUser && oidcUser.email) {
            const result = await this.authenticationService.validateSSOUser(oidcUser.email);
            // Normal login (no 2FA or 2FA not enabled)
            await new Promise<void>((resolve, reject) => {
                request.session.regenerate((error) => error ? reject(error) : resolve());
            });
            request.session.userId = result.user.uuid;
            await new Promise<void>((resolve, reject) => {
                request.session.save((error) => error ? reject(error) : resolve());
            });

            const url = await this.settingsService.get('frontend.url');
            if (!url) {
                throw new HttpException('Frontend URL not set', 500);
            }
            return res.redirect(url);
        }
    }
}
