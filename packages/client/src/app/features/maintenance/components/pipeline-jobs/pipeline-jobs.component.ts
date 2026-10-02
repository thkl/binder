import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import type { PipelineJobKind, PipelineJobMonitorQuery, PipelineJobStatus } from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import {
  PipelineJobKindFilter,
  PipelineJobService,
  PipelineJobStatusFilter,
} from '../../services/pipeline-job.service';

@Component({
  selector: 'binder-pipeline-jobs',
  standalone: true,
  imports: [CommonModule, DatePipe, TranslatePipe],
  templateUrl: './pipeline-jobs.component.html',
  styleUrl: './pipeline-jobs.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PipelineJobsComponent implements OnInit, OnDestroy {
  readonly pipeline = inject(PipelineJobService);
  readonly i18n = inject(I18nService);
  readonly statusFilter = signal<PipelineJobStatusFilter>('all');
  readonly kindFilter = signal<PipelineJobKindFilter>('all');
  readonly page = signal(1);
  readonly pageSize = 25;
  readonly retryingUuid = signal<string | null>(null);
  readonly statuses: PipelineJobStatusFilter[] = [
    'all',
    'queued',
    'running',
    'failed',
    'succeeded',
    'cancelled',
  ];
  readonly kinds: PipelineJobKindFilter[] = [
    'all',
    'malware-scan',
    'thumbnail',
    'text-extraction',
    'ocr',
    'embedding',
    'pdfa',
  ];
  readonly jobs = computed(() => this.pipeline.response()?.items ?? []);
  readonly meta = computed(() => this.pipeline.response()?.meta ?? null);
  private refreshTimer: number | null = null;

  ngOnInit(): void {
    void this.load();
    this.refreshTimer = window.setInterval(() => {
      if (!this.pipeline.loading()) void this.load();
    }, 5_000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
  }

  async load(): Promise<void> {
    const query: PipelineJobMonitorQuery = {
      page: this.page(),
      pageSize: this.pageSize,
    };
    const status = this.statusFilter();
    const kind = this.kindFilter();
    if (status !== 'all') query.status = status;
    if (kind !== 'all') query.kind = kind;
    await this.pipeline.load(query);
  }

  async updateStatusFilter(value: string): Promise<void> {
    this.statusFilter.set(value as PipelineJobStatusFilter);
    this.page.set(1);
    await this.load();
  }

  async updateKindFilter(value: string): Promise<void> {
    this.kindFilter.set(value as PipelineJobKindFilter);
    this.page.set(1);
    await this.load();
  }

  async changePage(page: number): Promise<void> {
    const totalPages = this.meta()?.totalPages ?? 0;
    if (page < 1 || (totalPages > 0 && page > totalPages)) return;
    this.page.set(page);
    await this.load();
  }

  async retry(uuid: string): Promise<void> {
    if (this.retryingUuid()) return;
    this.retryingUuid.set(uuid);
    const requeued = await this.pipeline.retry(uuid);
    this.retryingUuid.set(null);
    if (requeued) await this.load();
  }

  statusLabel(status: PipelineJobStatus): string {
    return this.i18n.t(`maintenance.pipeline.status.${status}`);
  }

  kindLabel(kind: PipelineJobKind): string {
    return this.i18n.t(`maintenance.pipeline.kind.${kind}`);
  }

  filterStatusLabel(status: PipelineJobStatusFilter): string {
    return status === 'all'
      ? this.i18n.t('maintenance.pipeline.allStatuses')
      : this.statusLabel(status);
  }

  filterKindLabel(kind: PipelineJobKindFilter): string {
    return kind === 'all' ? this.i18n.t('maintenance.pipeline.allKinds') : this.kindLabel(kind);
  }

  displayName(documentTitle: string | null, originalFilename: string): string {
    return documentTitle?.trim() || originalFilename;
  }

  canRetry(status: PipelineJobStatus): boolean {
    return status === 'failed' || status === 'cancelled';
  }

  isRetrying(uuid: string): boolean {
    return this.retryingUuid() === uuid;
  }
}
