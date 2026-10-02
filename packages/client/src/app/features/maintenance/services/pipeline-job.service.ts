import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  PipelineJobKind,
  PipelineJobMonitorQuery,
  PipelineJobMonitorResponse,
  PipelineJobMonitorResponseSchema,
  PipelineJobRetryResponseSchema,
  PipelineJobStatus,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class PipelineJobService {
  readonly response = signal<PipelineJobMonitorResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly application = inject(ApplicationService);

  constructor(private readonly http: HttpClient) {}

  async load(query: PipelineJobMonitorQuery): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const params: Record<string, string | number> = {
        page: query.page,
        pageSize: query.pageSize,
      };
      if (query.status) params['status'] = query.status;
      if (query.kind) params['kind'] = query.kind;

      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.application.getApiUrl('v1', 'pipeline/jobs'), {
          params,
          withCredentials: true,
        }),
      );
      this.response.set(PipelineJobMonitorResponseSchema.parse(response.data));
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async retry(uuid: string): Promise<boolean> {
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', `pipeline/jobs/${uuid}/retry`),
          {},
          { withCredentials: true },
        ),
      );
      return PipelineJobRetryResponseSchema.parse(response.data).requeued;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return false;
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (error instanceof HttpErrorResponse && error.status === 409) {
      return 'This pipeline job is no longer eligible for a retry.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'Pipeline jobs could not be loaded. Please try again.';
  }
}

export type PipelineJobStatusFilter = PipelineJobStatus | 'all';
export type PipelineJobKindFilter = PipelineJobKind | 'all';
