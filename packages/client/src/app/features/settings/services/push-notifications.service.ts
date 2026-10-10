import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiResponse } from '@binder/common';

export interface PushNotificationSettings {
  enabled: boolean;
  keyId: string;
  teamId: string;
  topic: string;
  documentAdded: boolean;
  processingComplete: boolean;
  processingFailed: boolean;
  hasAPNsKey: boolean;
}

const defaults: PushNotificationSettings = {
  enabled: false, keyId: '', teamId: '', topic: 'network.thkl.binder.ios',
  documentAdded: true, processingComplete: false, processingFailed: true, hasAPNsKey: false,
};

@Injectable({ providedIn: 'root' })
export class PushNotificationsService {
  readonly settings = signal<PushNotificationSettings>(defaults);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);
  private readonly baseUrl = '/api/v1/notifications/push-settings';

  constructor(private readonly http: HttpClient) {}

  async load(): Promise<void> {
    this.loading.set(true); this.error.set(null);
    try {
      const response = await firstValueFrom(this.http.get<ApiResponse<PushNotificationSettings>>(this.baseUrl, { withCredentials: true }));
      this.settings.set({ ...defaults, ...response.data });
    } catch (error) { this.error.set(this.message(error)); }
    finally { this.loading.set(false); }
  }

  update(changes: Partial<PushNotificationSettings>): void {
    this.settings.update((current) => ({ ...current, ...changes })); this.saved.set(false);
  }

  async save(): Promise<void> {
    this.saving.set(true); this.error.set(null); this.saved.set(false);
    const { enabled, keyId, teamId, topic, documentAdded, processingComplete, processingFailed } = this.settings();
    try {
      const response = await firstValueFrom(this.http.put<ApiResponse<PushNotificationSettings>>(this.baseUrl,
        { enabled, keyId, teamId, topic, documentAdded, processingComplete, processingFailed }, { withCredentials: true }));
      this.settings.set(response.data); this.saved.set(true);
    } catch (error) { this.error.set(this.message(error)); }
    finally { this.saving.set(false); }
  }

  async uploadKey(file: File): Promise<void> {
    const form = new FormData(); form.append('file', file);
    this.saving.set(true); this.error.set(null);
    try {
      const response = await firstValueFrom(this.http.post<ApiResponse<PushNotificationSettings>>(`${this.baseUrl}/apns-key`, form, { withCredentials: true }));
      this.settings.set(response.data); this.saved.set(false);
    } catch (error) { this.error.set(this.message(error)); }
    finally { this.saving.set(false); }
  }

  async deleteKey(): Promise<void> {
    this.saving.set(true); this.error.set(null);
    try {
      const response = await firstValueFrom(this.http.delete<ApiResponse<PushNotificationSettings>>(`${this.baseUrl}/apns-key`, { withCredentials: true }));
      this.settings.set(response.data);
    } catch (error) { this.error.set(this.message(error)); }
    finally { this.saving.set(false); }
  }

  private message(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') return error.error.message;
    return 'Push notification settings could not be updated.';
  }
}
