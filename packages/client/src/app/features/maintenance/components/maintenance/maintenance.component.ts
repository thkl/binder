import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import type { MaintenanceRun } from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { PipelineJobsComponent } from '../pipeline-jobs/pipeline-jobs.component';
import { MaintenanceService } from '../../services/maintenance.service';

@Component({
  selector: 'binder-maintenance',
  standalone: true,
  imports: [CommonModule, DatePipe, TranslatePipe, PipelineJobsComponent],
  templateUrl: './maintenance.component.html',
  styleUrl: './maintenance.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaintenanceComponent implements OnInit {
  readonly maintenance = inject(MaintenanceService);
  readonly i18n = inject(I18nService);
  readonly requestingBackup = signal(false);
  readonly actionMessage = signal<string | null>(null);
  readonly latestRuns = computed(() => {
    const latest = new Map<string, MaintenanceRun>();
    for (const run of this.maintenance.status()?.items ?? []) {
      if (!latest.has(run.jobKey)) latest.set(run.jobKey, run);
    }
    return [...latest.values()];
  });

  ngOnInit(): void {
    void this.maintenance.load();
  }

  async requestBackup(): Promise<void> {
    if (this.requestingBackup()) return;

    this.requestingBackup.set(true);
    this.actionMessage.set(null);
    const requestUuid = await this.maintenance.requestBackup();
    this.requestingBackup.set(false);

    if (!requestUuid) return;

    this.actionMessage.set(this.i18n.t('maintenance.requested'));
    await this.maintenance.load();
    window.setTimeout(() => void this.maintenance.load(), 3_000);
  }

  jobLabel(jobKey: MaintenanceRun['jobKey']): string {
    return this.i18n.t(`maintenance.job.${jobKey}`);
  }

  statusLabel(status: MaintenanceRun['status']): string {
    return this.i18n.t(`maintenance.status.${status}`);
  }

  fileSize(bytes: number | null): string {
    if (bytes === null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}
