import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiResponse } from '@binder/common';

export interface DropboxConnectionStatus {
  provider: string;
  connected: boolean;
  configured: boolean;
}

@Injectable({ providedIn: 'root' })
export class DropboxConnectionService {
  readonly status = signal<DropboxConnectionStatus | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor(private readonly http: HttpClient) {}

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<DropboxConnectionStatus>>('/api/v1/maintenance/dropbox/status', {
          withCredentials: true,
        }),
      );
      this.status.set(response.data);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  connect(): void {
    window.location.assign('/api/v1/maintenance/dropbox/connect');
  }

  async disconnect(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<null>>('/api/v1/maintenance/dropbox/connection', {
          withCredentials: true,
        }),
      );
      await this.load();
    } catch (error) {
      this.error.set(this.errorMessage(error));
      this.loading.set(false);
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string')
      return error.error.message;
    return 'Dropbox connection could not be updated.';
  }
}
