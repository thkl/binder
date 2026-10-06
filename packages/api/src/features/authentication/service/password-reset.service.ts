import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryTypes, Sequelize } from 'sequelize';
import { randomBytes, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { PasswordResetToken } from '../models/password-reset-token.entity';
import { UserStore } from '../stores/user.store';
import { User } from '../models/user.entity';
import { createTransport } from 'nodemailer';

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_RESPONSE = { accepted: true as const };

@Injectable()
export class PasswordResetService {
  private readonly logger = new BinderLogger(PasswordResetService.name);

  constructor(
    private readonly users: UserStore,
    private readonly settings: ApplicationSettingsService,
    private readonly sequelize: Sequelize,
    private readonly config: ConfigService<BinderConfig>,
  ) {}

  async request(identifier: string): Promise<{ accepted: true }> {
    const user = await this.users.findByLogin(identifier);
    if (!user || !user.isActive || !user.email || !user.passwordHash) return RESET_RESPONSE;

    await PasswordResetToken.destroy({ where: { userUuid: user.uuid } });
    const rawToken = randomBytes(32).toString('base64url');
    await PasswordResetToken.create({
      userUuid: user.uuid,
      tokenHash: this.hash(rawToken),
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
    const reset = await PasswordResetToken.findOne({
      where: { tokenHash: this.hash(token), usedAt: null },
    });
    if (!reset || reset.expiresAt.getTime() <= Date.now()) {
      return RESET_RESPONSE;
    }

    const user = await User.findByPk(reset.userUuid);
    if (!user || !user.isActive || !user.passwordHash) return RESET_RESPONSE;

    await this.sequelize.transaction(async (transaction) => {
      await user.update(
        { passwordHash: await argon2.hash(newPassword), mustChangePassword: false },
        { transaction },
      );
      await reset.update({ usedAt: new Date() }, { transaction });
      await this.sequelize.query(
        "DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = :userId",
        { replacements: { userId: user.uuid }, type: QueryTypes.DELETE, transaction },
      );
    });
    return RESET_RESPONSE;
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

  private hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
