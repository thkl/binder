import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiResponse } from '@binder/common';

export interface PushNotificationSettings {
  provider: 'apns' | 'pushover';
  enabled: boolean;
  keyId: string;
  teamId: string;
  topic: string;
  documentAdded: boolean;
  processingComplete: boolean;
  processingFailed: boolean;
  hasAPNsKey: boolean;
  pushoverAppToken: string;
  pushoverUserKey: string;
  hasPushoverAppToken: boolean;
  hasPushoverUserKey: boolean;
}

export interface RegisteredPushDevice {
  uuid: string;
  ownerUsername: string;
  deviceName: string;
  environment: 'sandbox' | 'production';
  createdAt: string;
  tokenHint: string;
}

const defaults: PushNotificationSettings = {
  provider: 'apns',
  enabled: false, keyId: '', teamId: '', topic: 'network.thkl.binder.ios',
  documentAdded: true, processingComplete: false, processingFailed: true, hasAPNsKey: false,
  pushoverAppToken: '', pushoverUserKey: '', hasPushoverAppToken: false, hasPushoverUserKey: false,
};

@Injectable({ providedIn: 'root' })
export class PushNotificationsService {
  readonly settings = signal<PushNotificationSettings>(defaults);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);
  readonly devices = signal<RegisteredPushDevice[]>([]);
  readonly deviceActionId = signal<string | null>(null);
  readonly deviceMessage = signal<string | null>(null);
  readonly deviceError = signal<string | null>(null);
  private readonly baseUrl = '/api/v1/notifications/push-settings';

  constructor(private readonly http: HttpClient) {}

  async load(): Promise<void> {
    this.loading.set(true); this.error.set(null);
    try {
      const [response, devicesResponse] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<PushNotificationSettings>>(this.baseUrl, { withCredentials: true })),
        firstValueFrom(this.http.get<ApiResponse<RegisteredPushDevice[]>>(`${this.baseUrl}/devices`, { withCredentials: true })),
      ]);
      this.settings.set({ ...defaults, ...response.data });
      this.devices.set(devicesResponse.data);
    } catch (error) { this.error.set(this.message(error)); }
    finally { this.loading.set(false); }
  }

  update(changes: Partial<PushNotificationSettings>): void {
    this.settings.update((current) => ({ ...current, ...changes })); this.saved.set(false);
  }

  async save(): Promise<void> {
    this.saving.set(true); this.error.set(null); this.saved.set(false);
    const { provider, enabled, keyId, teamId, topic, documentAdded, processingComplete, processingFailed,
      pushoverAppToken, pushoverUserKey } = this.settings();
    try {
      const response = await firstValueFrom(this.http.put<ApiResponse<PushNotificationSettings>>(this.baseUrl,
        { provider, enabled, keyId, teamId, topic, documentAdded, processingComplete, processingFailed,
          pushoverAppToken: pushoverAppToken.trim(), pushoverUserKey: pushoverUserKey.trim() }, { withCredentials: true }));
      this.settings.set({ ...defaults, ...response.data }); this.saved.set(true);
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

  async deletePushoverCredentials(): Promise<void> {
    this.saving.set(true); this.error.set(null);
    try {
      const response = await firstValueFrom(this.http.delete<ApiResponse<PushNotificationSettings>>(
        `${this.baseUrl}/pushover-credentials`, { withCredentials: true }));
      this.settings.set({ ...defaults, ...response.data });
    } catch (error) { this.error.set(this.message(error)); }
    finally { this.saving.set(false); }
  }

  async sendPushoverTest(): Promise<void> {
    this.deviceError.set(null); this.deviceMessage.set(null); this.deviceActionId.set('pushover');
    try {
      await firstValueFrom(this.http.post<ApiResponse<null>>(`${this.baseUrl}/test`, {}, { withCredentials: true }));
      this.deviceMessage.set('push.testSent');
    } catch (error) { this.deviceError.set(this.message(error)); }
    finally { this.deviceActionId.set(null); }
  }

  async removeDevice(device: RegisteredPushDevice): Promise<void> {
    this.deviceActionId.set(device.uuid); this.deviceError.set(null); this.deviceMessage.set(null);
    try {
      await firstValueFrom(this.http.delete<ApiResponse<null>>(`${this.baseUrl}/devices/${device.uuid}`, { withCredentials: true }));
      this.devices.update((devices) => devices.filter((item) => item.uuid !== device.uuid));
      this.deviceMessage.set('push.deviceRemoved');
    } catch (error) { this.deviceError.set(this.message(error)); }
    finally { this.deviceActionId.set(null); }
  }

  async sendTestPush(device: RegisteredPushDevice): Promise<void> {
    this.deviceActionId.set(device.uuid); this.deviceError.set(null); this.deviceMessage.set(null);
    try {
      await firstValueFrom(this.http.post<ApiResponse<null>>(`${this.baseUrl}/devices/${device.uuid}/test`, {}, { withCredentials: true }));
      this.deviceMessage.set('push.testSent');
    } catch (error) { this.deviceError.set(this.message(error)); }
    finally { this.deviceActionId.set(null); }
  }

  private message(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') return error.error.message;
    return 'Push notification settings could not be updated.';
  }
}
