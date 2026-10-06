import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { UserStore } from '../stores/user.store';
import { User } from '../models/user.entity';
import { createTransport } from 'nodemailer';
import { PasswordResetTokenStore, RESET_RESPONSE } from '../stores/token.store';

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class PasswordResetService {
  private readonly logger = new BinderLogger(PasswordResetService.name);

  constructor(
    private readonly users: UserStore,
    private readonly tokenStore: PasswordResetTokenStore,
    private readonly settings: ApplicationSettingsService,
    private readonly config: ConfigService<BinderConfig>,
  ) {}

  async request(identifier: string): Promise<{ accepted: true }> {
    const smtp = await this.getSmtpConfig();
    const user = await this.users.findByLogin(identifier);
    if (!user || !user.isActive || !user.email || !user.passwordHash) return RESET_RESPONSE;

    await this.tokenStore.deleteWhere({ userUuid: user.uuid });
    const rawToken = randomBytes(32).toString('base64url');
    await this.tokenStore.create({
      userUuid: user.uuid,
      tokenHash: this.tokenStore.hash(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      usedAt: null,
    });

    try {
      await this.sendResetEmail(user, rawToken, smtp);
    } catch (error) {
      this.logger.error('Password reset email could not be sent', {
        userUuid: user.uuid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return RESET_RESPONSE;
  }

  async confirm(token: string, newPassword: string): Promise<{ accepted: true }> {
    return this.tokenStore.confirm(token, newPassword);
  }

  private async getSmtpConfig(): Promise<SmtpConfig> {
    const enabled = (await this.settings.get('mailer.smtp.enabled', 'false')) === 'true';
    const host = (await this.settings.get('mailer.smtp.host', ''))?.trim();
    const fromAddress = (await this.settings.get('mailer.smtp.fromAddress', ''))?.trim();
    if (!enabled || !host || !fromAddress) {
      throw new ServiceUnavailableException(
        'Password reset email is not configured. Please contact an administrator.',
      );
    }

    return {
      host,
      fromAddress,
      port: Number(await this.settings.get('mailer.smtp.port', '587')) || 587,
      secure: (await this.settings.get('mailer.smtp.secure', 'false')) === 'true',
      username: await this.settings.get('mailer.smtp.username', ''),
      password: await this.settings.get('mailer.smtp.password', ''),
      fromName: (await this.settings.get('mailer.smtp.fromName', 'Binder')) || 'Binder',
    };
  }

  private async sendResetEmail(user: User, rawToken: string, smtp: SmtpConfig): Promise<void> {
    const rootUri = this.config.get<string>(ConfigKeys.ROOT_URI) ?? '';
    const resetUrl = `${rootUri.replace(/\/$/u, '')}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    });
    await transport.sendMail({
      from: { name: smtp.fromName, address: smtp.fromAddress },
      to: user.email as string,
      subject: 'Reset your Binder password',
      text: `Use this link to reset your Binder password. It expires in 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    });
  }
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string | undefined;
  password: string | undefined;
  fromAddress: string;
  fromName: string;
}
