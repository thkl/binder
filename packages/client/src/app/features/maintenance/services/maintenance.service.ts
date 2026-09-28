import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { ApiResponse, MaintenanceRequestResponseSchema, MaintenanceStatusResponse, MaintenanceStatusResponseSchema } from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class MaintenanceService {
  readonly status = signal<MaintenanceStatusResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly application = inject(ApplicationService);

  constructor(private readonly http: HttpClient) {}

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.application.getApiUrl('v1', 'maintenance/status'), { withCredentials: true })
      );
      this.status.set(MaintenanceStatusResponseSchema.parse(response.data));
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async requestBackup(): Promise<string | null> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(this.application.getApiUrl('v1', 'maintenance/backup'), {}, { withCredentials: true })
      );
      return MaintenanceRequestResponseSchema.parse(response.data).uuid;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (error instanceof HttpErrorResponse && error.status === 409) {
      return 'A database backup is already queued or running.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'Maintenance status could not be loaded. Please try again.';
  }
}
