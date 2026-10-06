import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AuthenticatedUser,
  AuthenticatedUserSchema,
  SetupAdminInput,
  SetupCheck,
  SetupCompletionResponse,
  SetupStatus,
  SetupStatusSchema,
  SetupValidationResponse,
  SetupValidationResponseSchema,
  RecoveryRestoreInput,
  MaintenanceRequestResponseSchema,
} from '@binder/common';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { SetupAlreadyCompletedError, SetupStateStore } from '../store/setup-state.store';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { SSOAuthenticationService } from '../../authentication/service/ssoauthentication.service';
import { PipelineWorkerHeartbeatStore } from '../../pipeline/store/pipeline-worker-heartbeat.store';
import { createGravatarUrl } from '../../authentication/service/gravatar';
import { SecretsService } from '../../../shared/config/secrets.service';
import { DropboxConnectionService } from '../../maintenance/service/dropbox-connection.service';
import { SessionRequest } from '../../authentication/models/request.model';
import { MaintenanceRequestStore } from '../../maintenance/store/maintenance-request.store';
import { EncryptionService } from '../../../shared/util/encryption.service';

interface SetupPaths {
  appRoot: string;
  storageRoot: string;
  inbox: string;
  derived: string;
  temporary: string;
  backup: string;
}

@Injectable()
export class SetupService {
  constructor(
    private readonly setupState: SetupStateStore,
    private readonly config: ConfigService<BinderConfig>,
    private readonly settings: ApplicationSettingsService,
    private readonly sso: SSOAuthenticationService,
    private readonly workerHeartbeats: PipelineWorkerHeartbeatStore,
    private readonly secrets: SecretsService,
    private readonly dropbox: DropboxConnectionService,
    private readonly maintenanceRequests: MaintenanceRequestStore,
    private readonly encryption: EncryptionService,
  ) {}

  async status(): Promise<SetupStatus> {
    const required = await this.setupState.isRequired();
    const onboardingRequired = await this.setupState.isOnboardingRequired();
    return SetupStatusSchema.parse({
      required,
      available: required && Boolean(this.secrets.get(ConfigKeys.SETUP_SECRET)),
      onboardingRequired,
      onboardingCompleted: !onboardingRequired && !required,
    });
  }

  async createAdministrator(input: SetupAdminInput): Promise<AuthenticatedUser> {
    const status = await this.status();
    if (!status.required) {
      throw new ConflictException('Initial administrator setup is already complete');
    }

    const configuredSecret = this.secrets.get(ConfigKeys.SETUP_SECRET);
    if (!configuredSecret || !this.secretsMatch(input.setupSecret, configuredSecret)) {
      throw new UnauthorizedException('The setup secret is invalid');
    }

    try {
      const user = await this.setupState.createInitialAdministrator({
        username: input.username.trim().toLowerCase(),
        passwordHash: await argon2.hash(input.password),
      });

      return AuthenticatedUserSchema.parse({
        uuid: user.uuid,
        username: user.username,
        isAdmin: user.isAdmin,
        mustChangePassword: user.mustChangePassword,
        gravatarUrl: createGravatarUrl(user.email),
      });
    } catch (error) {
      if (error instanceof SetupAlreadyCompletedError) {
        throw new ConflictException('Initial administrator setup is already complete');
      }
      throw error;
    }
  }

  async validateStorage(): Promise<SetupValidationResponse> {
    try {
      const paths = await this.resolvePaths();
      const checks = [
        await this.checkWritableDirectory('storage.root', paths.storageRoot),
        await this.checkWritableDirectory('storage.derived', paths.derived),
        await this.checkWritableDirectory('storage.temporary', paths.temporary),
        await this.checkWritableDirectory('storage.inbox', paths.inbox),
      ];

      const inboxRelativePath = relative(paths.storageRoot, paths.inbox);
      if (inboxRelativePath.startsWith('..') || isAbsolute(inboxRelativePath)) {
        checks.push({
          key: 'storage.inbox-location',
          status: 'error',
          message: 'The inbox must be inside the configured document storage root.',
        });
      }

      return this.validationResult(checks);
    } catch (error) {
      return this.validationResult([
        {
          key: 'storage.configuration',
          status: 'error',
          message: `Storage configuration could not be resolved: ${this.errorMessage(error)}`,
        },
      ]);
    }
  }

  async validateProcessing(): Promise<SetupValidationResponse> {
    const checks: SetupCheck[] = [];
    const ocrLanguages = await this.settings.get('pipeline.ocrLanguages', 'deu+eng');
    const pollIntervalMs = await this.settings.get('pipeline.pollIntervalMs', '2000');
    const lockTimeoutMs = await this.settings.get('pipeline.lockTimeoutMs', '900000');
    const reconcileIntervalMs = await this.settings.get('pipeline.reconcileIntervalMs', '30000');
    const malwareRequired = await this.settings.get('security.malwareScan.required', 'true');
    const malwareCommand = await this.settings.get('security.malwareScan.command', 'clamdscan');
    const inboxEnabled = await this.settings.get('inbox.enabled', 'false');
    const inboxOwnerUuid = await this.settings.get('inbox.importOwnerUuid');

    checks.push(
      this.checkValue(
        'processing.ocr-languages',
        Boolean(ocrLanguages && /^[a-z]{3}(?:\+[a-z]{3})*$/.test(ocrLanguages)),
        'OCR languages are configured.',
        'OCR languages must use three-letter codes such as deu+eng.',
      ),
      this.checkPositiveInteger('processing.poll-interval', pollIntervalMs),
      this.checkPositiveInteger('processing.lock-timeout', lockTimeoutMs),
      this.checkPositiveInteger('processing.reconcile-interval', reconcileIntervalMs),
    );

    if (malwareRequired === 'true' && !malwareCommand?.trim()) {
      checks.push({
        key: 'processing.malware-scanner',
        status: 'error',
        message: 'A malware scanner command is required by the security settings.',
      });
    }

    if (inboxEnabled === 'true' && !inboxOwnerUuid?.trim()) {
      checks.push({
        key: 'processing.inbox-owner',
        status: 'error',
        message: 'Inbox import is enabled but no import owner is configured.',
      });
    }

    try {
      const workers = await this.workerHeartbeats.findRecent(45_000);
      checks.push({
        key: 'processing.worker',
        status: workers.length > 0 ? 'ok' : 'warning',
        message:
          workers.length > 0
            ? `${workers.length} pipeline worker${workers.length === 1 ? '' : 's'} reported recently.`
            : 'No pipeline worker reported in the last 45 seconds. Start the worker before processing documents.',
      });
    } catch (error) {
      checks.push({
        key: 'processing.worker',
        status: 'warning',
        message: `Worker status could not be read: ${this.errorMessage(error)}`,
      });
    }

    return this.validationResult(checks);
  }

  async validateOidc(): Promise<SetupValidationResponse> {
    const issuer = await this.settings.get('oidc.ISSUER_URL');
    const clientId = await this.settings.get('oidc.CLIENT_ID');
    const clientSecret = await this.settings.get('oidc.CLIENT_SECRET');

    if (!issuer && !clientId && !clientSecret) {
      return this.validationResult([
        {
          key: 'oidc.optional',
          status: 'warning',
          message: 'OIDC is not configured. Local authentication remains available.',
        },
      ]);
    }

    if (!issuer || !clientId || !clientSecret) {
      return this.validationResult([
        {
          key: 'oidc.configuration',
          status: 'error',
          message: 'OIDC requires an issuer URL, client ID, and client secret.',
        },
      ]);
    }

    try {
      const valid = await this.sso.validateConfiguration();
      return this.validationResult([
        {
          key: 'oidc.discovery',
          status: valid ? 'ok' : 'error',
          message: valid
            ? 'OIDC discovery succeeded and the provider is reachable.'
            : 'OIDC configuration is incomplete.',
        },
      ]);
    } catch (error) {
      return this.validationResult([
        {
          key: 'oidc.discovery',
          status: 'error',
          message: `OIDC discovery failed: ${this.errorMessage(error)}`,
        },
      ]);
    }
  }

  async validateBackup(): Promise<SetupValidationResponse> {
    const backupRoot = await this.settings.get(
      'backup.root',
      join(this.config.get<string>(ConfigKeys.APP_ROOT_PATH) ?? process.cwd(), 'backup'),
    );
    const enabled = await this.settings.get('backup.enabled', 'false');
    const schedule = await this.settings.get('backup.schedule', '0 2 * * *');
    const retentionDays = await this.settings.get('backup.retentionDays', '30');

    const checks = [
      await this.checkWritableDirectory('backup.destination', backupRoot ?? ''),
      this.checkValue(
        'backup.schedule',
        Boolean(schedule?.trim() && schedule.trim().split(/\s+/).length === 5),
        'The backup schedule uses a five-field cron expression.',
        'The backup schedule must contain five cron fields.',
      ),
      this.checkPositiveInteger('backup.retention', retentionDays),
      {
        key: 'backup.enabled',
        status: enabled === 'true' ? ('ok' as const) : ('warning' as const),
        message:
          enabled === 'true'
            ? 'Scheduled backups are enabled.'
            : 'Scheduled backups are disabled. You can still create manual backups.',
      },
    ];

    return this.validationResult(checks);
  }

  async listRecoveryBackups(accessToken?: string, remoteFolder?: string) {
    return this.dropbox.listRecoveryBackups(accessToken, remoteFolder);
  }

  async listPublicRecoveryBackups(accessToken?: string, remoteFolder?: string) {
    if (!(await this.setupState.isRequired())) {
      throw new UnauthorizedException(
        'Public recovery is only available before administrator setup',
      );
    }
    return this.dropbox.listRecoveryBackups(accessToken, remoteFolder);
  }

  async authorizePublicRecovery(request: SessionRequest, response: Response): Promise<void> {
    if (!(await this.setupState.isRequired())) {
      throw new UnauthorizedException(
        'Public recovery is only available before administrator setup',
      );
    }
    return this.dropbox.authorize(request, response, '/');
  }

  async requestRecoveryRestore(input: RecoveryRestoreInput) {
    if (input.backupPassword !== input.backupPasswordConfirmation) {
      throw new BadRequestException('The backup encryption passwords do not match');
    }
    const pending = await this.maintenanceRequests.findPendingRestore();
    if (pending) throw new ConflictException('A recovery restore is already queued');
    const encryptedPassword = this.encryption.encrypt(input.backupPassword);
    const encryptedAccessToken = input.accessToken
      ? this.encryption.encrypt(input.accessToken)
      : null;
    const request = await this.maintenanceRequests.create({
      jobKey: 'restore',
      payload: {
        filename: input.filename,
        remoteFolder: input.remoteFolder ?? '/',
        password: encryptedPassword.encrypted,
        passwordIv: encryptedPassword.iv,
        ...(encryptedAccessToken
          ? { accessToken: encryptedAccessToken.encrypted, accessTokenIv: encryptedAccessToken.iv }
          : {}),
      },
    });
    return MaintenanceRequestResponseSchema.parse({ uuid: request.uuid });
  }

  async completeOnboarding(): Promise<SetupCompletionResponse> {
    const status = await this.status();
    if (status.required) {
      throw new ConflictException('Create the administrator before completing onboarding');
    }

    const validations = await Promise.all([
      this.validateStorage(),
      this.validateProcessing(),
      this.validateBackup(),
    ]);
    const errors = validations.flatMap((validation) =>
      validation.checks.filter((check) => check.status === 'error'),
    );
    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'SETUP_VALIDATION_FAILED',
        message: 'Resolve the required setup checks before completing onboarding.',
        checks: errors,
      });
    }

    try {
      const completedAt = await this.setupState.completeOnboarding();
      return {
        completed: true,
        completedAt: completedAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof SetupAlreadyCompletedError) {
        throw new ConflictException('Onboarding is no longer available');
      }
      throw error;
    }
  }

  private async resolvePaths(): Promise<SetupPaths> {
    const appRoot = this.config.get<string>(ConfigKeys.APP_ROOT_PATH) ?? process.cwd();
    const configuredStorageRoot = await this.settings.get(
      'documents.storageRoot',
      this.config.get<string>(ConfigKeys.DOCUMENT_STORAGE_ROOT) ?? join(appRoot, 'storage'),
    );
    const storageRoot = this.resolvePath(appRoot, configuredStorageRoot ?? '');
    const configuredInbox = await this.settings.get('inbox.path', 'inbox');
    const configuredBackup = await this.settings.get('backup.root', join(appRoot, 'backup'));

    return {
      appRoot,
      storageRoot,
      inbox: this.resolvePath(storageRoot, configuredInbox ?? 'inbox'),
      derived: join(storageRoot, 'derived'),
      temporary: join(storageRoot, 'tmp'),
      backup: this.resolvePath(appRoot, configuredBackup ?? ''),
    };
  }

  private resolvePath(base: string, configured: string): string {
    return isAbsolute(configured) ? resolve(configured) : resolve(base, configured);
  }

  private async checkWritableDirectory(key: string, configuredPath: string): Promise<SetupCheck> {
    if (!configuredPath) {
      return { key, status: 'error', message: 'A directory path is required.' };
    }

    const probePath = join(configuredPath, `.binder-setup-${randomUUID()}.tmp`);
    try {
      await fs.mkdir(configuredPath, { recursive: true, mode: 0o770 });
      await fs.writeFile(probePath, 'binder setup check\n', { mode: 0o660 });
      await fs.rm(probePath, { force: true });
      return { key, status: 'ok', message: `${configuredPath} is readable and writable.` };
    } catch (error) {
      await fs.rm(probePath, { force: true }).catch(() => undefined);
      return {
        key,
        status: 'error',
        message: `${configuredPath} is not writable: ${this.errorMessage(error)}`,
      };
    }
  }

  private checkPositiveInteger(key: string, value: string | undefined): SetupCheck {
    const valid = Boolean(value && /^[0-9]+$/.test(value) && Number(value) > 0);
    return {
      key,
      status: valid ? 'ok' : 'error',
      message: valid ? 'The value is a positive whole number.' : 'The value must be positive.',
    };
  }

  private checkValue(
    key: string,
    valid: boolean,
    successMessage: string,
    errorMessage: string,
  ): SetupCheck {
    return { key, status: valid ? 'ok' : 'error', message: valid ? successMessage : errorMessage };
  }

  private validationResult(checks: SetupCheck[]): SetupValidationResponse {
    return SetupValidationResponseSchema.parse({
      valid: checks.every((check) => check.status !== 'error'),
      checks,
      checkedAt: new Date().toISOString(),
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private secretsMatch(provided: string, configured: string): boolean {
    const providedDigest = createHash('sha256').update(provided).digest();
    const configuredDigest = createHash('sha256').update(configured).digest();
    return timingSafeEqual(providedDigest, configuredDigest);
  }
}
