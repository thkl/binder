import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApplicationService {
  private readonly mobileServerUrlKey = 'binder.mobile.serverUrl';

  getApiUrl(version: string, endpoint: string, optional?: string): string {
    const mobileServerUrl = this.getMobileServerUrl();
    const apiUrl = mobileServerUrl ? `${mobileServerUrl}/api` : environment.apiUrl;
    const result = `${apiUrl}/${version}/${endpoint}`;
    return optional ? `${result}${optional}` : result;
  }

  isNativeMobile(): boolean {
    if (typeof window === 'undefined') return false;
    const capacitor = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    return capacitor?.isNativePlatform?.() === true;
  }

  getMobileServerUrl(): string | null {
    if (!this.isNativeMobile()) return null;
    const saved = window.localStorage.getItem(this.mobileServerUrlKey);
    return saved ? this.normalizeMobileServerUrl(saved) : null;
  }

  saveMobileServerUrl(value: string): string {
    const normalized = this.normalizeMobileServerUrl(value);
    if (!this.isNativeMobile()) {
      throw new Error('A Binder server address can only be configured in the mobile app.');
    }
    if (!normalized) {
      throw new Error(
        'Enter a valid HTTP or HTTPS site address without credentials or query text.',
      );
    }
    window.localStorage.setItem(this.mobileServerUrlKey, normalized);
    return normalized;
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
