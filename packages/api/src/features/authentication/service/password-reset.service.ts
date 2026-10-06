import { Injectable } from '@nestjs/common';
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
      await this.sendResetEmail(user, rawToken);
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

  private async sendResetEmail(user: User, rawToken: string): Promise<void> {
    const enabled = (await this.settings.get('mailer.smtp.enabled', 'false')) === 'true';
    const host = (await this.settings.get('mailer.smtp.host', ''))?.trim();
    const fromAddress = (await this.settings.get('mailer.smtp.fromAddress', ''))?.trim();
    if (!enabled || !host || !fromAddress) throw new Error('SMTP is not configured or enabled');

    const port = Number(await this.settings.get('mailer.smtp.port', '587')) || 587;
    const secure = (await this.settings.get('mailer.smtp.secure', 'false')) === 'true';
    const username = await this.settings.get('mailer.smtp.username', '');
    const password = await this.settings.get('mailer.smtp.password', '');
    const fromName = (await this.settings.get('mailer.smtp.fromName', 'Binder')) || 'Binder';
    const rootUri = this.config.get<string>(ConfigKeys.ROOT_URI) ?? '';
    const resetUrl = `${rootUri.replace(/\/$/u, '')}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const transport = createTransport({
      host,
      port,
      secure,
      auth: username ? { user: username, pass: password } : undefined,
    });
    await transport.sendMail({
      from: { name: fromName, address: fromAddress },
      to: user.email as string,
      subject: 'Reset your Binder password',
      text: `Use this link to reset your Binder password. It expires in 30 minutes:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    });
  }
}
