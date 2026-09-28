import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MaintenanceStatusResponseSchema } from '@binder/common';
import { BinderConfig, ConfigKeys } from '../../../shared/config/config.keys';
import { MaintenanceRunStore } from '../store/maintenance-run.store';

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly runs: MaintenanceRunStore,
    private readonly config: ConfigService<BinderConfig>
  ) {}

  async getStatus() {
    const items = await this.runs.listRecent();

    return MaintenanceStatusResponseSchema.parse({
      backupRootConfigured: Boolean(this.config.get<string>(ConfigKeys.BACKUP_ROOT_PATH)),
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
