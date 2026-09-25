import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AuthenticatedUser,
  AuthenticatedUserSchema,
  ChangePasswordInputSchema,
  LoginInputSchema
} from '@binder/common';

type ApiResponse<T> = { data: T };
type SSOActiveResponse = {isActive:boolean};

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AuthenticatedUser | null>(null);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  private readonly apiUrl = '/api/v1';

  constructor(private readonly http: HttpClient) {}

  async restoreSession(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(`${this.apiUrl}/auth/session`, { withCredentials: true })
      );
      this.user.set(response.data === null ? null : AuthenticatedUserSchema.parse(response.data));
    } catch (error) {
      this.user.set(null);
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async isSSOActive(): Promise<boolean> {
    const response = await firstValueFrom(
        this.http.get<ApiResponse<SSOActiveResponse>>(`${this.apiUrl}/ssoauth/active`)
      );
    return response.data.isActive;
  }

  async login(username: string, password: string): Promise<boolean> {
    const input = LoginInputSchema.safeParse({ username, password });
    if (!input.success) {
      this.error.set('Enter a username and password.');
      return false;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(`${this.apiUrl}/auth/login`, input.data, { withCredentials: true })
      );
      this.user.set(AuthenticatedUserSchema.parse(response.data));
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.submitting.set(false);
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    const input = ChangePasswordInputSchema.safeParse({ currentPassword, newPassword });
    if (!input.success) {
      this.error.set('The new password must contain at least 12 characters.');
      return false;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(`${this.apiUrl}/auth/password`, input.data, { withCredentials: true })
      );
      this.user.set(AuthenticatedUserSchema.parse(response.data));
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.submitting.set(false);
    }
  }

  async logout(): Promise<void> {
    await firstValueFrom(
      this.http.post<ApiResponse<null>>(`${this.apiUrl}/auth/logout`, {}, { withCredentials: true })
    );
    this.user.set(null);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Invalid username or password.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The server could not be reached. Please try again.';
  }
}
