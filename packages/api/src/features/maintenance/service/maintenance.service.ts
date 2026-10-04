import { ConflictException, Injectable } from '@nestjs/common';
import { MaintenanceRequestResponseSchema, MaintenanceStatusResponseSchema } from '@binder/common';
import { MaintenanceRunStore } from '../store/maintenance-run.store';
import { MaintenanceRequestStore } from '../store/maintenance-request.store';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly runs: MaintenanceRunStore,
    private readonly requests: MaintenanceRequestStore,
    private readonly settings: ApplicationSettingsService,
  ) {}

  async getStatus() {
    await this.runs.failStaleRuns();
    const items = await this.runs.listRecent();
    const backupScope =
      (await this.settings.get('backup.scope', 'full')) === 'database' ? 'database' : 'full';

    return MaintenanceStatusResponseSchema.parse({
      backupRootConfigured: Boolean((await this.settings.get('backup.root'))?.trim()),
      backupScope,
      items: items.map((item) => ({
        uuid: item.uuid,
        jobKey: item.jobKey,
        status: item.status,
        startedAt: item.startedAt.toISOString(),
        finishedAt: item.finishedAt?.toISOString() ?? null,
        nextRunAt: item.nextRunAt?.toISOString() ?? null,
        durationMs: item.durationMs,
        artifactName: item.artifactName,
        sizeBytes: item.sizeBytes === null ? null : Number(item.sizeBytes),
        deletedFiles: item.deletedFiles,
        checkedFiles: item.checkedFiles,
        issueCount: item.issueCount,
        error: item.error,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    });
  }

  async requestBackup() {
    await this.runs.failStaleRuns();
    const pending = await this.requests.findPendingBackup();
    const running = await this.runs.findRunning('backup');
    if (pending || running) {
      throw new ConflictException('A database backup is already queued or running');
    }

    const request = await this.requests.create({ jobKey: 'backup' });
    return MaintenanceRequestResponseSchema.parse({ uuid: request.uuid });
  }
}
