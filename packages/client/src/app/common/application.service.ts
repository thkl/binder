import { Injectable } from '@angular/core';
import { registerPlugin } from '@capacitor/core';
import { environment } from '../../environments/environment';

type MobileNativePlugin = {
  getServerUrl(): Promise<{ url?: string | null }>;
  setServerUrl(options: { url: string }): Promise<void>;
  getPendingSharedFiles(): Promise<{ files?: PendingSharedFile[] }>;
  readPendingSharedFileChunk(options: {
    id: string;
    offset: number;
    length: number;
  }): Promise<{ base64?: string }>;
  completePendingSharedFile(options: { id: string }): Promise<void>;
};

export type PendingSharedFile = { id: string; name: string; size: number };

type CapacitorWindow = Window & {
  Capacitor?: {
    isNativePlatform?: () => boolean;
  };
};

const binderMobilePlugin = registerPlugin<MobileNativePlugin>('BinderMobile');

@Injectable({ providedIn: 'root' })
export class ApplicationService {
  private readonly mobileServerUrlKey = 'binder.mobile.serverUrl';
  private mobilePlugin: MobileNativePlugin | null = null;

  getApiUrl(version: string, endpoint: string, optional?: string): string {
    const result = `${environment.apiUrl}/${version}/${endpoint}`;
    return optional ? `${result}${optional}` : result;
  }

  isNativeMobile(): boolean {
    if (typeof window === 'undefined') return false;
    const capacitor = (window as CapacitorWindow).Capacitor;
    return capacitor?.isNativePlatform?.() === true;
  }

  isMobileBootstrapOrigin(): boolean {
    if (!this.isNativeMobile()) return false;
    return (
      window.location.hostname.toLowerCase() === 'localhost' &&
      ['capacitor:', 'https:', 'http:'].includes(window.location.protocol)
    );
  }

  getMobileServerUrl(): string | null {
    if (!this.isNativeMobile()) return null;
    const saved = window.localStorage.getItem(this.mobileServerUrlKey);
    if (saved) return this.normalizeMobileServerUrl(saved);
    return this.isMobileBootstrapOrigin()
      ? null
      : this.normalizeMobileServerUrl(window.location.origin);
  }

  async restoreNativeMobileServerUrl(): Promise<string | null> {
    if (!this.isNativeMobile()) return null;

    try {
      const result = await this.getMobilePlugin().getServerUrl();
      let normalized = result.url ? this.normalizeMobileServerUrl(result.url) : null;
      if (!normalized) {
        const legacySaved = window.localStorage.getItem(this.mobileServerUrlKey);
        normalized = legacySaved ? this.normalizeMobileServerUrl(legacySaved) : null;
        if (normalized) await this.getMobilePlugin().setServerUrl({ url: normalized });
      }
      if (normalized) window.localStorage.setItem(this.mobileServerUrlKey, normalized);
      return normalized;
    } catch {
      const saved = window.localStorage.getItem(this.mobileServerUrlKey);
      return saved ? this.normalizeMobileServerUrl(saved) : null;
    }
  }

  async saveMobileServerUrl(value: string): Promise<string> {
    const normalized = this.normalizeMobileServerUrl(value);
    if (!this.isNativeMobile()) {
      throw new Error('A Binder server address can only be configured in the mobile app.');
    }
    if (!normalized) {
      throw new Error(
        'Enter a valid HTTP or HTTPS site address without credentials or query text.',
      );
    }
    await this.getMobilePlugin().setServerUrl({ url: normalized });
    window.localStorage.setItem(this.mobileServerUrlKey, normalized);
    return normalized;
  }

  async getPendingSharedFiles(): Promise<PendingSharedFile[]> {
    if (!this.isNativeMobile()) return [];
    const result = await this.getMobilePlugin().getPendingSharedFiles();
    return (result.files ?? []).filter(
      (file) =>
        typeof file.id === 'string' &&
        /^[0-9a-f-]{36}$/i.test(file.id) &&
        typeof file.name === 'string' &&
        Number.isSafeInteger(file.size) &&
        file.size > 0 &&
        file.size <= 50 * 1024 * 1024,
    );
  }

  async readPendingSharedFileChunk(id: string, offset: number, length: number): Promise<string> {
    const result = await this.getMobilePlugin().readPendingSharedFileChunk({ id, offset, length });
    if (typeof result.base64 !== 'string') throw new Error('Shared file data is unavailable.');
    return result.base64;
  }

  async completePendingSharedFile(id: string): Promise<void> {
    await this.getMobilePlugin().completePendingSharedFile({ id });
  }

  private getMobilePlugin(): MobileNativePlugin {
    if (this.mobilePlugin) return this.mobilePlugin;
    const capacitor = (window as CapacitorWindow).Capacitor;
    if (!capacitor?.isNativePlatform?.()) throw new Error('The mobile app bridge is unavailable.');
    this.mobilePlugin = binderMobilePlugin;
    return this.mobilePlugin;
  }

  private normalizeMobileServerUrl(value: string): string | null {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (url.username || url.password || url.search || url.hash) return null;
      let pathname = url.pathname.replace(/\/+$/, '');
      pathname = pathname.replace(/\/api$/i, '');
      return `${url.origin}${pathname}`.replace(/\/+$/, '');
    } catch {
      return null;
    }
  }
}
