import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Op } from 'sequelize';
import {
  ApplicationSetting,
  Document,
  DocumentStorageIssue,
  MaintenanceRequest,
  MaintenanceRun,
  PipelineJob,
  PipelineJobEvent,
} from './models.js';
import { sequelize } from './database.js';
import { FileBackupService, FileBackupSettings } from './file-backup.service.js';
import { FileProviderFactory } from './file-provider/file-provider-factory.js';
import { decryptSettingSecret } from './config.js';
import { logger } from './logger.js';
import { CronSchedule } from './maintenance-cron.js';
import { resolveStoragePath } from './storage.js';

const BACKUP_NAME = /^binder-\d{8}-\d{6}\.dump$/;
const ENCRYPTED_BACKUP_NAME = /^binder-\d{8}-\d{6}\.tar\.gz\.age$/;

interface MaintenanceSettings {
  root: string;
  enabled: boolean;
  schedule: string;
  retentionDays: number;
  timezone: string;
  storageConsistencyEnabled: boolean;
  storageConsistencySchedule: string;
  pipelineJobRetentionDays: number;
  backup: FileBackupSettings;
}

interface StorageProblem {
  issueType: 'missing' | 'size-mismatch' | 'checksum-mismatch' | 'unreadable';
  actualSizeBytes: number | null;
  actualChecksumSha256: string | null;
  details: string;
}

interface RecoveryRequestPayload {
  filename: string;
  remoteFolder: string;
  password: string;
  passwordIv: string;
  accessToken?: string;
  accessTokenIv?: string;
}

const DEFAULT_SETTINGS: MaintenanceSettings = {
  root: path.resolve(process.env.APP_ROOT_PATH ?? process.cwd(), 'backup'),
  enabled: false,
  schedule: '0 2 * * *',
  retentionDays: 30,
  timezone: 'UTC',
  storageConsistencyEnabled: true,
  storageConsistencySchedule: '0 3 * * *',
  pipelineJobRetentionDays: 10,
  backup: {
    root: path.resolve(process.env.APP_ROOT_PATH ?? process.cwd(), 'backup'),
    encryptionPassword: '',
    scope: 'full',
    provider: 'none',
    remoteFolder: '/Binder backups',
    removeLocalAfterUpload: false,
  },
};

export class MaintenanceScheduler {
  private readonly fileBackup = new FileBackupService();
  private readonly providers = new FileProviderFactory();
  private timer?: NodeJS.Timeout;
  private readonly lastTriggeredMinutes = new Map<string, number>();
  private running = false;
  private stopping = false;
  private activeTick?: Promise<void>;
  private lastPipelineJobCleanupDay?: string;

  async start(): Promise<void> {
    try {
      await this.recoverInterruptedRuns();
      await this.triggerTick();
    } catch (error) {
      logger.error(
        'Maintenance scheduler initialization failed; pipeline processing will continue',
        {
          error: this.errorMessage(error),
        },
      );
    }
    this.timer = setInterval(() => void this.triggerTick(), 5_000);
    logger.info('Worker maintenance scheduler started');
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.activeTick;
  }

  private triggerTick(): Promise<void> {
    if (!this.activeTick) {
      this.activeTick = this.tick().finally(() => {
        this.activeTick = undefined;
      });
    }
    return this.activeTick;
  }

  private async tick(): Promise<void> {
    if (this.stopping || this.running) return;
    this.running = true;

    try {
      const settings = await this.loadSettings();
      const restoreRun = await this.claimRestore();
      if (restoreRun) {
        await this.executeRestore(restoreRun);
        return;
      }
      await this.runPipelineJobRetention(settings.pipelineJobRetentionDays);
      const manualRun = await this.claimManualBackup();
      if (manualRun) {
        await this.executeBackup(manualRun, settings);
        return;
      }

      const now = new Date();
      if (
        settings.enabled &&
        this.shouldTrigger('backup', settings.schedule, now, settings.timezone)
      ) {
        this.markTriggered('backup', now);
        const schedule = new CronSchedule(settings.schedule);
        const nextRunAt = schedule.nextOccurrence(now, settings.timezone);
        await this.runBackup(settings, nextRunAt);
        await this.runRetention(settings, nextRunAt);
      }

      if (
        settings.storageConsistencyEnabled &&
        this.shouldTrigger(
          'storage-consistency',
          settings.storageConsistencySchedule,
          now,
          settings.timezone,
        )
      ) {
        this.markTriggered('storage-consistency', now);
        const schedule = new CronSchedule(settings.storageConsistencySchedule);
        await this.runStorageConsistency(schedule.nextOccurrence(now, settings.timezone));
      }
    } catch (error) {
      logger.error('Maintenance tick failed; will retry', { error: this.errorMessage(error) });
    } finally {
      this.running = false;
    }
  }

  private async runBackup(settings: MaintenanceSettings, nextRunAt: Date | null): Promise<void> {
    if (await this.hasRunning('backup')) return;
    const run = await this.startRun('backup', nextRunAt);
    await this.executeBackup(run, settings);
  }

  private async executeBackup(run: MaintenanceRun, settings: MaintenanceSettings): Promise<void> {
    const started = Date.now();

    try {
      const result = await this.fileBackup.create(settings.backup);
      await run.update({
        status: 'succeeded',
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        artifactName: result.artifactName,
        sizeBytes: result.sizeBytes,
        error: null,
      });
      logger.info('Backup completed', result);
    } catch (error) {
      await run.update({
        status: 'failed',
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        error: this.errorMessage(error),
      });
      logger.error('Backup failed', {
        scope: settings.backup.scope,
        error: this.errorMessage(error),
      });
    }
  }

  private async executeRestore(run: MaintenanceRun): Promise<void> {
    const started = Date.now();
    const payload = run.getDataValue('restorePayload') as RecoveryRequestPayload | undefined;
    try {
      if (!payload?.filename || !payload.password || !payload.passwordIv) {
        throw new Error('Recovery request payload is incomplete');
      }
      const password = decryptSettingSecret(payload.password, payload.passwordIv);
      const provider = payload.accessToken
        ? this.providers.createWithAccessToken(
            decryptSettingSecret(payload.accessToken, payload.accessTokenIv ?? ''),
          )
        : await this.providers.create();
      if (!provider) throw new Error('No Dropbox provider is configured for recovery');

      const remoteFolder = payload.remoteFolder || '/';
      const remotePath = `${remoteFolder === '/' ? '' : remoteFolder.replace(/\/$/, '')}/${payload.filename}`;
      logger.info('Recovery restore started', { runUuid: run.uuid, remotePath });
      const result = await this.fileBackup.restoreEncryptedBackup(provider, remotePath, password);
      await run
        .update({
          status: 'succeeded',
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          artifactName: result.artifactName,
          error: null,
        })
        .catch((error) =>
          logger.warn(
            'Recovery completed but its status could not be persisted after database restore',
            {
              runUuid: run.uuid,
              error: this.errorMessage(error),
            },
          ),
        );
      logger.info('Recovery restore finished successfully; restart the API and worker', {
        runUuid: run.uuid,
        scope: result.scope,
        storageRestored: result.storageRestored,
      });
      // The restored database can invalidate this process' ORM state and pipeline leases.
      // Let the container supervisor start a clean worker after the successful restore.
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
    } catch (error) {
      await run
        .update({
          status: 'failed',
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          error: this.errorMessage(error),
        })
        .catch((updateError) =>
          logger.warn('Recovery failure status could not be persisted', {
            runUuid: run.uuid,
            error: this.errorMessage(updateError),
          }),
        );
      logger.error('Recovery restore failed; no further restore steps were attempted', {
        runUuid: run.uuid,
        error: this.errorMessage(error),
      });
    }
  }

  private async runRetention(settings: MaintenanceSettings, nextRunAt: Date | null): Promise<void> {
    if (await this.hasRunning('backup-retention')) return;
    const run = await this.startRun('backup-retention', nextRunAt);
    const started = Date.now();

    try {
      const deletedFiles = await this.removeExpired(settings.root, settings.retentionDays);
      const deletedRemoteFiles = await this.fileBackup.removeExpiredRemoteBackups(
        settings.backup,
        settings.retentionDays,
      );
      await run.update({
        status: 'succeeded',
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        deletedFiles: deletedFiles + deletedRemoteFiles,
        error: null,
      });
      logger.info('Backup retention cleanup completed', {
        deletedFiles,
        deletedRemoteFiles,
        retentionDays: settings.retentionDays,
      });
    } catch (error) {
      await run.update({
        status: 'failed',
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        error: this.errorMessage(error),
      });
      logger.error('Backup retention cleanup failed', { error: this.errorMessage(error) });
    }
  }

  private async runStorageConsistency(nextRunAt: Date | null): Promise<void> {
    if (await this.hasRunning('storage-consistency')) return;

    const run = await this.startRun('storage-consistency', nextRunAt);
    const started = Date.now();

    try {
      const result = await this.checkStorageConsistency();
      await run.update({
        status: 'succeeded',
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        checkedFiles: result.checkedFiles,
        issueCount: result.issueCount,
        error: null,
      });
      logger.info('Document storage consistency check completed', result);
    } catch (error) {
      await run.update({
        status: 'failed',
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        error: this.errorMessage(error),
      });
      logger.error('Document storage consistency check failed', {
        error: this.errorMessage(error),
      });
    }
  }

  private async runPipelineJobRetention(retentionDays: number): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastPipelineJobCleanupDay === today) return;

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const deletedJobs = await sequelize.transaction(async (transaction) => {
      const jobs = await PipelineJob.findAll({
        attributes: ['uuid'],
        where: {
          status: { [Op.in]: ['succeeded', 'failed', 'cancelled'] },
          completedAt: { [Op.lt]: cutoff },
        },
        transaction,
      });
      const jobUuids = jobs.map((job) => job.uuid);
      if (jobUuids.length === 0) return 0;

      await PipelineJobEvent.destroy({
        where: { jobUuid: { [Op.in]: jobUuids } },
        transaction,
      });
      return PipelineJob.destroy({ where: { uuid: { [Op.in]: jobUuids } }, transaction });
    });

    this.lastPipelineJobCleanupDay = today;
    if (deletedJobs > 0) {
      logger.info('Completed pipeline jobs cleaned up', { deletedJobs, retentionDays });
    }
  }

  private async checkStorageConsistency(): Promise<{ checkedFiles: number; issueCount: number }> {
    const documents = await Document.findAll({
      attributes: ['uuid', 'ownerUuid', 'storageKey', 'sizeBytes', 'checksumSha256'],
      order: [['uuid', 'ASC']],
    });
    let issueCount = 0;

    for (const document of documents) {
      const problem = await this.inspectDocument(document);
      if (problem) {
        issueCount += 1;
        await this.openStorageIssue(document, problem);
        continue;
      }

      await this.resolveStorageIssue(document.uuid);
    }

    return { checkedFiles: documents.length, issueCount };
  }

  private async inspectDocument(document: Document): Promise<StorageProblem | null> {
    let filePath: string;
    try {
      filePath = resolveStoragePath(document.storageKey);
    } catch (error) {
      return {
        issueType: 'unreadable',
        actualSizeBytes: null,
        actualChecksumSha256: null,
        details: `The configured storage key is invalid: ${this.errorMessage(error)}`,
      };
    }

    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (error) {
      const code = this.errorCode(error);
      return {
        issueType: code === 'ENOENT' ? 'missing' : 'unreadable',
        actualSizeBytes: null,
        actualChecksumSha256: null,
        details:
          code === 'ENOENT'
            ? 'The original document file is missing from storage.'
            : `The original document file could not be read: ${this.errorMessage(error)}`,
      };
    }

    if (!stats.isFile()) {
      return {
        issueType: 'unreadable',
        actualSizeBytes: stats.size,
        actualChecksumSha256: null,
        details: 'The document storage key does not point to a regular file.',
      };
    }

    const expectedSizeBytes = Number(document.sizeBytes);
    if (stats.size !== expectedSizeBytes) {
      return {
        issueType: 'size-mismatch',
        actualSizeBytes: stats.size,
        actualChecksumSha256: null,
        details: `The file size is ${stats.size} bytes, but the database expects ${expectedSizeBytes} bytes.`,
      };
    }

    try {
      const actualChecksumSha256 = await this.calculateChecksum(filePath);
      if (actualChecksumSha256 !== document.checksumSha256) {
        return {
          issueType: 'checksum-mismatch',
          actualSizeBytes: stats.size,
          actualChecksumSha256,
          details: 'The file checksum differs from the checksum stored in the database.',
        };
      }
    } catch (error) {
      return {
        issueType: 'unreadable',
        actualSizeBytes: stats.size,
        actualChecksumSha256: null,
        details: `The document file could not be checksummed: ${this.errorMessage(error)}`,
      };
    }

    return null;
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }

    return hash.digest('hex');
  }

  private async openStorageIssue(document: Document, problem: StorageProblem): Promise<void> {
    const now = new Date();
    const issue = await DocumentStorageIssue.findOne({ where: { documentUuid: document.uuid } });
    const values = {
      ownerUuid: document.ownerUuid,
      documentUuid: document.uuid,
      issueType: problem.issueType,
      status: 'open' as const,
      expectedSizeBytes: Number(document.sizeBytes),
      actualSizeBytes: problem.actualSizeBytes,
      expectedChecksumSha256: document.checksumSha256,
      actualChecksumSha256: problem.actualChecksumSha256,
      details: problem.details.slice(0, 1000),
      lastDetectedAt: now,
      resolvedAt: null,
    };

    if (issue) {
      await issue.update(values);
      return;
    }

    await DocumentStorageIssue.create({
      uuid: randomUUID(),
      firstDetectedAt: now,
      ...values,
    });
    logger.warn('Document storage issue detected', {
      documentUuid: document.uuid,
      ownerUuid: document.ownerUuid,
      issueType: problem.issueType,
      storageKey: document.storageKey,
    });
  }

  private async resolveStorageIssue(documentUuid: string): Promise<void> {
    const issue = await DocumentStorageIssue.findOne({ where: { documentUuid, status: 'open' } });
    if (!issue) return;

    const now = new Date();
    await issue.update({ status: 'resolved', resolvedAt: now, lastDetectedAt: now });
    logger.info('Document storage issue resolved', { documentUuid });
  }

  private async removeExpired(backupRoot: string, retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const entries = await fs.readdir(backupRoot, { withFileTypes: true }).catch(() => []);
    let deletedFiles = 0;
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        (!BACKUP_NAME.test(entry.name) && !ENCRYPTED_BACKUP_NAME.test(entry.name))
      )
        continue;
      const artifactPath = path.join(backupRoot, entry.name);
      if ((await fs.stat(artifactPath)).mtimeMs >= cutoff) continue;
      await fs.unlink(artifactPath);
      await fs.rm(path.join(backupRoot, `${entry.name}.json`), { force: true });
      deletedFiles += 1;
    }
    return deletedFiles;
  }

  private async loadSettings(): Promise<MaintenanceSettings> {
    const rows = await ApplicationSetting.findAll({
      where: {
        key: {
          [Op.in]: [
            'backup.enabled',
            'backup.schedule',
            'backup.retentionDays',
            'maintenance.timezone',
            'maintenance.storageConsistency.enabled',
            'maintenance.storageConsistency.schedule',
            'pipeline.jobRetentionDays',
          ],
        },
      },
    });
    const values = new Map(rows.map((setting) => [setting.key, setting.value]));
    const retentionDays = Number(values.get('backup.retentionDays'));
    const backup = await FileBackupService.loadSettings();
    return {
      root: backup.root,
      backup,
      enabled: values.get('backup.enabled')?.toLowerCase() === 'true',
      schedule: values.get('backup.schedule')?.trim() || '0 2 * * *',
      retentionDays: Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 30,
      timezone: values.get('maintenance.timezone')?.trim() || 'UTC',
      storageConsistencyEnabled:
        values.get('maintenance.storageConsistency.enabled')?.toLowerCase() !== 'false',
      storageConsistencySchedule:
        values.get('maintenance.storageConsistency.schedule')?.trim() || '0 3 * * *',
      pipelineJobRetentionDays:
        Number.isInteger(Number(values.get('pipeline.jobRetentionDays'))) &&
        Number(values.get('pipeline.jobRetentionDays')) > 0
          ? Number(values.get('pipeline.jobRetentionDays'))
          : 10,
    };
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const [updated] = await MaintenanceRun.update(
      {
        status: 'failed',
        finishedAt: new Date(),
        error: 'Worker restarted before the maintenance job completed',
      },
      { where: { status: 'running' } },
    );
    if (updated > 0)
      logger.warn('Marked interrupted maintenance runs as failed', { count: updated });
  }

  private async hasRunning(
    jobKey: 'backup' | 'backup-retention' | 'storage-consistency' | 'restore',
  ): Promise<boolean> {
    return Boolean(await MaintenanceRun.findOne({ where: { jobKey, status: 'running' } }));
  }

  private async claimRestore(): Promise<MaintenanceRun | null> {
    return sequelize.transaction(async (transaction) => {
      const request = await MaintenanceRequest.findOne({
        where: { jobKey: 'restore' },
        order: [['createdAt', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
      });
      if (!request) return null;

      const run = await MaintenanceRun.create(
        {
          uuid: randomUUID(),
          jobKey: 'restore',
          status: 'running',
          startedAt: new Date(),
          finishedAt: null,
          nextRunAt: null,
          durationMs: null,
          artifactName: null,
          sizeBytes: null,
          deletedFiles: null,
          checkedFiles: null,
          issueCount: null,
          error: null,
        },
        { transaction },
      );
      // Keep the encrypted payload attached to the in-memory run only. It is never logged
      // and is not persisted in maintenance_runs.
      run.setDataValue('restorePayload', request.payload as unknown as RecoveryRequestPayload);
      await request.destroy({ transaction });
      logger.info('Claimed recovery restore request', {
        requestUuid: request.uuid,
        runUuid: run.uuid,
        filename: request.payload?.filename,
      });
      return run;
    });
  }

  private async claimManualBackup(): Promise<MaintenanceRun | null> {
    return sequelize.transaction(async (transaction) => {
      const request = await MaintenanceRequest.findOne({
        where: { jobKey: 'backup' },
        order: [['createdAt', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
      });
      if (!request) return null;

      const run = await MaintenanceRun.create(
        {
          uuid: randomUUID(),
          jobKey: 'backup',
          status: 'running',
          startedAt: new Date(),
          finishedAt: null,
          nextRunAt: null,
          durationMs: null,
          artifactName: null,
          sizeBytes: null,
          deletedFiles: null,
          checkedFiles: null,
          issueCount: null,
          error: null,
        },
        { transaction },
      );
      await request.destroy({ transaction });
      logger.info('Claimed manual backup request', {
        requestUuid: request.uuid,
        runUuid: run.uuid,
      });
      return run;
    });
  }

  private startRun(
    jobKey: 'backup' | 'backup-retention' | 'storage-consistency',
    nextRunAt: Date | null,
  ): Promise<MaintenanceRun> {
    return MaintenanceRun.create({
      uuid: randomUUID(),
      jobKey,
      status: 'running',
      startedAt: new Date(),
      finishedAt: null,
      nextRunAt,
      durationMs: null,
      artifactName: null,
      sizeBytes: null,
      deletedFiles: null,
      checkedFiles: null,
      issueCount: null,
      error: null,
    } as never);
  }

  private resolveConfiguredPath(configuredPath: string): string {
    return path.isAbsolute(configuredPath)
      ? path.normalize(configuredPath)
      : path.resolve(process.env.APP_ROOT_PATH ?? process.cwd(), configuredPath);
  }

  private shouldTrigger(jobKey: string, expression: string, now: Date, timezone: string): boolean {
    const schedule = new CronSchedule(expression);
    const minute = Math.floor(now.getTime() / 60_000);
    return schedule.matches(now, timezone) && this.lastTriggeredMinutes.get(jobKey) !== minute;
  }

  private markTriggered(jobKey: string, now: Date): void {
    this.lastTriggeredMinutes.set(jobKey, Math.floor(now.getTime() / 60_000));
  }

  private timestamp(date: Date): string {
    return date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')
      .replace('T', '-')
      .replace('Z', '');
  }

  private errorMessage(error: unknown): string {
    if (
      error &&
      typeof error === 'object' &&
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      error.stderr.trim()
    )
      return error.stderr.trim().slice(0, 2000);
    return error instanceof Error ? error.message : String(error);
  }

  private errorCode(error: unknown): string | null {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
      return error.code;
    }
    return null;
  }
}

export const maintenanceScheduler = new MaintenanceScheduler();
