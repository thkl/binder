import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  ApplicationSettingsResponse,
  ApplicationSettingsResponseSchema,
  SetApplicationSettingInput,
  UserDirectoryItem,
  UserDirectoryResponseSchema,
  ApiToken,
  ApiTokenListResponseSchema,
  CreatedApiTokenSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly settings = signal<ApplicationSettingsResponse | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly users = signal<UserDirectoryItem[]>([]);
  readonly apiTokens = signal<ApiToken[]>([]);

  private readonly apiUrl = '/api/v1/settings';

  constructor(private readonly http: HttpClient) {}

  async load(): Promise<ApplicationSettingsResponse | null> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.apiUrl, { withCredentials: true }),
      );
      const settings = ApplicationSettingsResponseSchema.parse(response.data);
      this.settings.set(settings);
      return settings;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async saveAll(input: SetApplicationSettingInput[]): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(`${this.apiUrl}/all`, input, {
          withCredentials: true,
        }),
      );
      this.settings.set(ApplicationSettingsResponseSchema.parse(response.data));
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async loadUsers(): Promise<UserDirectoryItem[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>('/api/v1/auth/users', { withCredentials: true }),
      );
      const users = UserDirectoryResponseSchema.parse(response.data).items;
      this.users.set(users);
      return users;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return [];
    }
  }

  async loadApiTokens(): Promise<ApiToken[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>('/api/v1/auth/api-tokens', { withCredentials: true }),
      );
      const tokens = ApiTokenListResponseSchema.parse(response.data).items;
      this.apiTokens.set(tokens);
      return tokens;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return [];
    }
  }

  async createApiToken(input: { name: string; permissions: string[] }): Promise<string | null> {
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>('/api/v1/auth/api-tokens', input, {
          withCredentials: true,
        }),
      );
      const created = CreatedApiTokenSchema.parse(response.data);
      this.apiTokens.update((tokens) => [created.apiToken, ...tokens]);
      return created.token;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  async revokeApiToken(uuid: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.delete(`/api/v1/auth/api-tokens/${uuid}`, { withCredentials: true }),
      );
      this.apiTokens.update((tokens) =>
        tokens.map((token) =>
          token.uuid === uuid ? { ...token, revokedAt: new Date().toISOString() } : token,
        ),
      );
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The settings could not be loaded. Please try again.';
  }
}
