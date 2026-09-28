import { Injectable } from '@nestjs/common';
import { MaintenanceStatusResponseSchema } from '@binder/common';
import { MaintenanceRunStore } from '../store/maintenance-run.store';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly runs: MaintenanceRunStore,
    private readonly settings: ApplicationSettingsService
  ) {}

  async getStatus() {
    const items = await this.runs.listRecent();

    return MaintenanceStatusResponseSchema.parse({
      backupRootConfigured: Boolean((await this.settings.get('backup.root'))?.trim()),
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
        error: item.error,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString()
      }))
    });
  }
}
