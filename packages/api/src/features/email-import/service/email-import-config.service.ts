import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EncryptionService } from '../../../shared/util/encryption.service';
import { EmailImportConfig } from '../models/email-import-config.entity';

export interface EmailImportConfigInput {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string | null;
  mailbox: string;
  pollIntervalMs: number;
  deleteAfterImport: boolean;
  trustedSenders: string[];
}

@Injectable()
export class EmailImportConfigService {
  constructor(private readonly encryption: EncryptionService) {}

  async get(ownerUuid: string): Promise<Record<string, unknown> | null> {
    const config = await EmailImportConfig.findOne({ where: { ownerUuid } });
    if (!config) return null;
    return this.toResponse(config);
  }

  async save(ownerUuid: string, input: EmailImportConfigInput): Promise<Record<string, unknown>> {
    const existing = await EmailImportConfig.findOne({ where: { ownerUuid } });
    const passwordProvided = input.password !== undefined;
    let password = existing?.password ?? null;
    let passwordIv = existing?.passwordIv ?? null;

    if (input.enabled && (!input.host.trim() || !input.username.trim())) {
      throw new BadRequestException('An IMAP host and username are required when email import is enabled');
    }

    if (passwordProvided) {
      if (input.password) {
        const encrypted = this.encryption.encrypt(input.password);
        password = encrypted.encrypted;
        passwordIv = encrypted.iv;
      } else {
        password = null;
        passwordIv = null;
      }
    }

    if (input.enabled && (!password || !passwordIv)) {
      throw new BadRequestException('An IMAP password or app password is required when email import is enabled');
    }

    const config = existing
      ? await existing.update({
          ...input,
          password,
          passwordIv,
          trustedSenders: normalizeSenders(input.trustedSenders),
        })
      : await EmailImportConfig.create({
          ownerUuid,
          ...input,
          password,
          passwordIv,
          trustedSenders: normalizeSenders(input.trustedSenders),
          lastPolledAt: null,
          lastError: null,
        });

    return this.toResponse(config);
  }

  async getWorkerConfigs(): Promise<EmailImportConfig[]> {
    return EmailImportConfig.findAll({ where: { enabled: true } });
  }

  async decryptPassword(config: EmailImportConfig): Promise<string> {
    if (!config.password || !config.passwordIv) {
      throw new NotFoundException('Email import password is not configured');
    }
    return this.encryption.decrypt(config.password, config.passwordIv);
  }

  private toResponse(config: EmailImportConfig): Record<string, unknown> {
    return {
      uuid: config.uuid,
      enabled: config.enabled,
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      hasPassword: Boolean(config.password && config.passwordIv),
      mailbox: config.mailbox,
      pollIntervalMs: config.pollIntervalMs,
      deleteAfterImport: config.deleteAfterImport,
      trustedSenders: config.trustedSenders,
      lastPolledAt: config.lastPolledAt,
      lastError: config.lastError,
    };
  }
}

function normalizeSenders(senders: string[]): string[] {
  return [...new Set(senders.map((sender) => sender.trim().toLowerCase()).filter(Boolean))];
}
