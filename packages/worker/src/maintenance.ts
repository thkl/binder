import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { Op } from 'sequelize';
import { ApplicationSetting, MaintenanceRequest, MaintenanceRun } from './models.js';
import { sequelize } from './database.js';
import { logger } from './logger.js';
import { CronSchedule } from './maintenance-cron.js';

const execFileAsync = promisify(execFile);
const BACKUP_NAME = /^binder-\d{8}-\d{6}\.dump$/;

interface MaintenanceSettings {
  root: string;
  enabled: boolean;
  schedule: string;
  retentionDays: number;
  timezone: string;
}

const DEFAULT_SETTINGS: MaintenanceSettings = {
  root: path.resolve(process.env.APP_ROOT_PATH ?? process.cwd(), 'backup'),
  enabled: false,
  schedule: '0 2 * * *',
  retentionDays: 30,
  timezone: 'UTC'
};

export class MaintenanceScheduler {
  private timer?: NodeJS.Timeout;
  private lastTriggeredMinute: number | null = null;
  private running = false;
  private stopping = false;
  private activeTick?: Promise<void>;

  async start(): Promise<void> {
    try {
      await this.recoverInterruptedRuns();
      await this.triggerTick();
    } catch (error) {
      logger.error('Maintenance scheduler initialization failed; pipeline processing will continue', {
        error: this.errorMessage(error)
      });
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
      const manualRun = await this.claimManualBackup();
      if (manualRun) {
        await this.executeBackup(manualRun, settings.root);
        return;
      }

      if (!settings.enabled) return;

      const schedule = new CronSchedule(settings.schedule);
      const now = new Date();
      const minute = Math.floor(now.getTime() / 60_000);
      if (!schedule.matches(now, settings.timezone) || this.lastTriggeredMinute === minute) return;

      this.lastTriggeredMinute = minute;
      const nextRunAt = schedule.nextOccurrence(now, settings.timezone);
      await this.runBackup(settings.root, nextRunAt);
      await this.runRetention(settings.root, settings.retentionDays, nextRunAt);
    } catch (error) {
      logger.error('Maintenance tick failed; will retry', { error: this.errorMessage(error) });
    } finally {
      this.running = false;
    }
  }

  private async runBackup(backupRoot: string, nextRunAt: Date | null): Promise<void> {
    if (await this.hasRunning('backup')) return;
    const run = await this.startRun('backup', nextRunAt);
    await this.executeBackup(run, backupRoot);
  }

  private async executeBackup(run: MaintenanceRun, backupRoot: string): Promise<void> {
    const started = Date.now();

    try {
      const result = await this.createBackup(backupRoot);
      await run.update({
        status: 'succeeded',
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        artifactName: result.artifactName,
        sizeBytes: result.sizeBytes,
        error: null
      });
      logger.info('PostgreSQL backup completed', result);
    } catch (error) {
      await run.update({ status: 'failed', finishedAt: new Date(), durationMs: Date.now() - started, error: this.errorMessage(error) });
      logger.error('PostgreSQL backup failed', { error: this.errorMessage(error) });
    }
  }

  private async runRetention(backupRoot: string, retentionDays: number, nextRunAt: Date | null): Promise<void> {
    if (await this.hasRunning('backup-retention')) return;
    const run = await this.startRun('backup-retention', nextRunAt);
    const started = Date.now();

    try {
      const deletedFiles = await this.removeExpired(backupRoot, retentionDays);
      await run.update({ status: 'succeeded', finishedAt: new Date(), durationMs: Date.now() - started, deletedFiles, error: null });
      logger.info('Backup retention cleanup completed', { deletedFiles, retentionDays });
    } catch (error) {
      await run.update({ status: 'failed', finishedAt: new Date(), durationMs: Date.now() - started, error: this.errorMessage(error) });
      logger.error('Backup retention cleanup failed', { error: this.errorMessage(error) });
    }
  }

  private async createBackup(backupRoot: string): Promise<{ artifactName: string; sizeBytes: number }> {
    await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });

    const artifactName = `binder-${this.timestamp(new Date())}.dump`;
    const temporaryPath = path.join(backupRoot, `.${artifactName}.${process.pid}.${randomUUID()}.tmp`);
    const artifactPath = path.join(backupRoot, artifactName);
    const manifestPath = path.join(backupRoot, `${artifactName}.json`);

    try {
      const { stderr } = await execFileAsync(process.env.PG_DUMP_PATH ?? 'pg_dump', [
        '--format=custom', '--file', temporaryPath,
        '--host', process.env.DATABASE_HOST ?? 'localhost',
        '--port', String(process.env.DATABASE_PORT ?? 5432),
        '--username', process.env.DATABASE_USER ?? 'binder',
        process.env.DATABASE_NAME ?? 'binder'
      ], {
        env: { ...process.env, PGPASSWORD: process.env.DATABASE_PASSWORD ?? '' },
        maxBuffer: 1024 * 1024
      });

      if (stderr.trim()) logger.warn('pg_dump reported warnings', { stderr: stderr.trim().slice(0, 2000) });
      await fs.chmod(temporaryPath, 0o600);
      await fs.rename(temporaryPath, artifactPath);
      const stats = await fs.stat(artifactPath);
      await fs.writeFile(manifestPath, `${JSON.stringify({
        format: 'pg_dump-custom',
        createdAt: new Date().toISOString(),
        database: process.env.DATABASE_NAME ?? 'binder',
        host: process.env.DATABASE_HOST ?? 'localhost',
        port: Number(process.env.DATABASE_PORT ?? 5432),
        applicationVersion: process.env.APP_VERSION ?? 'unknown',
        artifactName,
        sizeBytes: stats.size
      }, null, 2)}\n`, { mode: 0o600 });

      return { artifactName, sizeBytes: stats.size };
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new Error(this.errorMessage(error));
    }
  }

  private async removeExpired(backupRoot: string, retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const entries = await fs.readdir(backupRoot, { withFileTypes: true }).catch(() => []);
    let deletedFiles = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !BACKUP_NAME.test(entry.name)) continue;
      const artifactPath = path.join(backupRoot, entry.name);
      const stats = await fs.stat(artifactPath);
      if (stats.mtimeMs >= cutoff) continue;
      await fs.unlink(artifactPath);
      await fs.rm(path.join(backupRoot, `${entry.name}.json`), { force: true });
      deletedFiles += 1;
    }
    return deletedFiles;
  }

  private async loadSettings(): Promise<MaintenanceSettings> {
    const settings = await ApplicationSetting.findAll({
      where: { key: { [Op.in]: ['backup.root', 'backup.enabled', 'backup.schedule', 'backup.retentionDays', 'maintenance.timezone'] } }
    });
    const values = new Map(settings.map((setting) => [setting.key, setting.value]));
    const retentionDays = Number(values.get('backup.retentionDays'));

    return {
      root: this.resolveConfiguredPath(values.get('backup.root')?.trim() || DEFAULT_SETTINGS.root),
      enabled: values.get('backup.enabled') === undefined ? DEFAULT_SETTINGS.enabled : values.get('backup.enabled')?.toLowerCase() === 'true',
      schedule: values.get('backup.schedule')?.trim() || DEFAULT_SETTINGS.schedule,
      retentionDays: Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : DEFAULT_SETTINGS.retentionDays,
      timezone: values.get('maintenance.timezone')?.trim() || DEFAULT_SETTINGS.timezone
    };
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const [updated] = await MaintenanceRun.update({
      status: 'failed',
      finishedAt: new Date(),
      error: 'Worker restarted before the maintenance job completed'
    }, { where: { status: 'running' } });
    if (updated > 0) logger.warn('Marked interrupted maintenance runs as failed', { count: updated });
  }

  private async hasRunning(jobKey: 'backup' | 'backup-retention'): Promise<boolean> {
    return Boolean(await MaintenanceRun.findOne({ where: { jobKey, status: 'running' } }));
  }

  private async claimManualBackup(): Promise<MaintenanceRun | null> {
    return sequelize.transaction(async (transaction) => {
      const request = await MaintenanceRequest.findOne({
        where: { jobKey: 'backup' },
        order: [['createdAt', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      });
      if (!request) return null;

      const run = await MaintenanceRun.create({
        uuid: randomUUID(), jobKey: 'backup', status: 'running', startedAt: new Date(), finishedAt: null,
        nextRunAt: null, durationMs: null, artifactName: null, sizeBytes: null, deletedFiles: null, error: null
      }, { transaction });
      await request.destroy({ transaction });
      logger.info('Claimed manual PostgreSQL backup request', { requestUuid: request.uuid, runUuid: run.uuid });
      return run;
    });
  }

  private startRun(jobKey: 'backup' | 'backup-retention', nextRunAt: Date | null): Promise<MaintenanceRun> {
    return MaintenanceRun.create({
      uuid: randomUUID(), jobKey, status: 'running', startedAt: new Date(), finishedAt: null,
      nextRunAt, durationMs: null, artifactName: null, sizeBytes: null, deletedFiles: null, error: null
    } as never);
  }

  private resolveConfiguredPath(configuredPath: string): string {
    return path.isAbsolute(configuredPath)
      ? path.normalize(configuredPath)
      : path.resolve(process.env.APP_ROOT_PATH ?? process.cwd(), configuredPath);
  }

  private timestamp(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-').replace('Z', '');
  }

  private errorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()) return error.stderr.trim().slice(0, 2000);
    return error instanceof Error ? error.message : String(error);
  }
}

export const maintenanceScheduler = new MaintenanceScheduler();
