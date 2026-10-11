import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { EncryptionService } from '../../../shared/util/encryption.service';
import { EmailImportConfig } from '../models/email-import-config.entity';
import { EmailImportApprovedServerStore } from '../store/email-import-approved-server.store';

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
  constructor(
    private readonly encryption: EncryptionService,
    private readonly approvedServers: EmailImportApprovedServerStore,
  ) {}

  async listApprovedServers(): Promise<Array<{ uuid: string; host: string; port: number }>> {
    const servers = await this.approvedServers.findAll();
    return servers.map((server) => ({
      uuid: server.uuid,
      host: server.host,
      port: server.port,
    }));
  }

  async approveServer(
    host: string,
    port: number,
    approvedBy: string,
  ): Promise<{ uuid: string; host: string; port: number }> {
    const normalizedHost = normalizeImapHost(host);
    const server = await this.approvedServers.create(normalizedHost, port, approvedBy);
    return { uuid: server.uuid, host: server.host, port: server.port };
  }

  async removeApprovedServer(uuid: string): Promise<void> {
    if ((await this.approvedServers.delete(uuid)) === 0) {
      throw new NotFoundException('Approved IMAP server was not found');
    }
  }

  async get(ownerUuid: string): Promise<Record<string, unknown> | null> {
    const config = await EmailImportConfig.findOne({ where: { ownerUuid } });
    if (!config) return null;
    return this.toResponse(config);
  }

  async delete(ownerUuid: string): Promise<void> {
    await EmailImportConfig.destroy({ where: { ownerUuid } });
  }

  async save(ownerUuid: string, input: EmailImportConfigInput): Promise<Record<string, unknown>> {
    const host = input.host.trim() ? normalizeImapHost(input.host) : '';
    if (input.enabled && !(await this.approvedServers.findByHostAndPort(host, input.port))) {
      throw new ForbiddenException(
        'This IMAP host and port has not been approved by an administrator',
      );
    }

    const existing = await EmailImportConfig.findOne({ where: { ownerUuid } });
    const passwordProvided = input.password !== undefined;
    let password = existing?.password ?? null;
    let passwordIv = existing?.passwordIv ?? null;

    if (input.enabled && (!input.host.trim() || !input.username.trim())) {
      throw new BadRequestException(
        'An IMAP host and username are required when email import is enabled',
      );
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
      throw new BadRequestException(
        'An IMAP password or app password is required when email import is enabled',
      );
    }

    const config = existing
      ? await existing.update({
          ...input,
          host,
          password,
          passwordIv,
          trustedSenders: normalizeSenders(input.trustedSenders),
        })
      : await EmailImportConfig.create({
          ownerUuid,
          ...input,
          host,
          password,
          passwordIv,
          trustedSenders: normalizeSenders(input.trustedSenders),
          lastPolledAt: null,
          lastUidValidity: null,
          lastMessageUid: null,
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

function normalizeImapHost(host: string): string {
  const trimmed = host
    .trim()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
    .toLowerCase();
  if (isIP(trimmed)) return trimmed;
  const normalized = domainToASCII(trimmed);
  const validHostname =
    normalized.length <= 253 &&
    normalized.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
  if (!validHostname) {
    throw new BadRequestException('Enter a valid IMAP server hostname or IP address');
  }
  return normalized.toLowerCase();
}

function normalizeSenders(senders: string[]): string[] {
  return [...new Set(senders.map((sender) => sender.trim().toLowerCase()).filter(Boolean))];
}
