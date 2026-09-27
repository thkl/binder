import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { ApiResponse, LogFile, LogFileListResponseSchema } from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class LogsService {
  readonly files = signal<LogFile[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly previewFilename = signal<string | null>(null);
  readonly previewText = signal<string | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly application = inject(ApplicationService);

  constructor(private readonly http: HttpClient) {}

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.application.getApiUrl('v1', 'logs'), { withCredentials: true })
      );
      this.files.set(LogFileListResponseSchema.parse(response.data).items);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  downloadUrl(filename: string): string {
    return this.application.getApiUrl('v1', 'logs', `/${encodeURIComponent(filename)}`);
  }

  previewUrl(filename: string): string {
    return `${this.downloadUrl(filename)}?view=true`;
  }

  async preview(filename: string): Promise<void> {
    this.previewFilename.set(filename);
    this.previewText.set(null);
    this.previewLoading.set(true);
    this.previewError.set(null);

    try {
      const text = await firstValueFrom(
        this.http.get(this.previewUrl(filename), {
          withCredentials: true,
          responseType: 'text'
        })
      );
      this.previewText.set(text);
    } catch (error) {
      this.previewError.set(this.getErrorMessage(error));
    } finally {
      this.previewLoading.set(false);
    }
  }

  closePreview(): void {
    this.previewFilename.set(null);
    this.previewText.set(null);
    this.previewError.set(null);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The log files could not be loaded. Please try again.';
  }
}
