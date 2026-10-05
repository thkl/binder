import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface EmailImportConfig {
  uuid: string;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  hasPassword: boolean;
  mailbox: string;
  pollIntervalMs: number;
  deleteAfterImport: boolean;
  trustedSenders: string[];
  lastPolledAt: string | null;
  lastError: string | null;
}

@Injectable({ providedIn: 'root' })
export class EmailImportService {
  readonly config = signal<EmailImportConfig | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor(private readonly http: HttpClient) {}

  async load(): Promise<EmailImportConfig | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<{ data: EmailImportConfig | null }>('/api/v1/email-import/config', {
          withCredentials: true,
        }),
      );
      this.config.set(response.data);
      return response.data;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async save(input: Record<string, unknown>): Promise<EmailImportConfig | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.put<{ data: EmailImportConfig }>('/api/v1/email-import/config', input, {
          withCredentials: true,
        }),
      );
      this.config.set(response.data);
      return response.data;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  async delete(): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.delete('/api/v1/email-import/config', { withCredentials: true }),
      );
      this.config.set(null);
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string')
      return error.error.message;
    return 'The email import settings could not be saved. Please try again.';
  }
}
