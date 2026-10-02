import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AuthenticatedUser,
  AuthenticatedUserSchema,
  ChangePasswordInputSchema,
  LoginInputSchema,
  SetupAdminInputSchema,
  SetupStatus,
  SetupStatusSchema,
  CsrfTokenSchema,
} from '@binder/common';
import { ApplicationService } from '../../../common/application.service';
import { CsrfService } from '../../../common/security/csrf.service';

type ApiResponse<T> = { data: T; csrfToken?: unknown };
type SSOActiveResponse = { isActive: boolean };

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AuthenticatedUser | null>(null);
  readonly loading = signal(true);
  readonly setupRequired = signal(false);
  readonly setupAvailable = signal(false);
  readonly onboardingActive = signal(false);
  readonly setupStatus = signal<SetupStatus | null>(null);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly appService = inject(ApplicationService);

  constructor(
    private readonly http: HttpClient,
    private readonly csrf: CsrfService,
  ) {}

  async restoreSession(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.onboardingActive.set(false);
    try {
      try {
        const setupResponse = await firstValueFrom(
          this.http.get<ApiResponse<unknown>>(this.appService.getApiUrl('v1', 'setup/status')),
        );
        const setup = SetupStatusSchema.parse(setupResponse.data);
        this.setupStatus.set(setup);
        this.setupRequired.set(setup.required);
        this.setupAvailable.set(setup.available);
        if (setup.required) {
          this.user.set(null);
          return;
        }
      } catch {
        this.setupRequired.set(false);
        this.setupAvailable.set(false);
      }

      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.appService.getApiUrl('v1', 'auth/session'), {
          withCredentials: true,
        }),
      );
      this.setCsrfToken(response);
      const user = response.data === null ? null : AuthenticatedUserSchema.parse(response.data);
      this.user.set(user);
      this.onboardingActive.set(Boolean(user?.isAdmin && this.setupStatus()?.onboardingRequired));
    } catch (error) {
      this.user.set(null);
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async createAdministrator(
    setupSecret: string,
    username: string,
    password: string,
  ): Promise<boolean> {
    const input = SetupAdminInputSchema.safeParse({ setupSecret, username, password });
    if (!input.success) {
      this.error.set(
        'Enter the setup secret, a username, and a password with at least 12 characters.',
      );
      return false;
    }

    this.submitting.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'setup/admin'),
          input.data,
          { withCredentials: true },
        ),
      );
      this.setCsrfToken(response);
      this.user.set(AuthenticatedUserSchema.parse(response.data));
      this.setupRequired.set(false);
      this.setupAvailable.set(false);
      this.onboardingActive.set(true);
      this.setupStatus.set({
        required: false,
        available: false,
        onboardingRequired: true,
        onboardingCompleted: false,
      });
      return true;
    } catch (error) {
      this.error.set(
        this.getErrorMessage(error, 'The setup secret is invalid or setup is already complete.'),
      );
      return false;
    } finally {
      this.submitting.set(false);
    }
  }

  async isSSOActive(): Promise<boolean> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<SSOActiveResponse>>(
        this.appService.getApiUrl('v1', 'ssoauth/active'),
      ),
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
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'auth/login'),
          input.data,
          { withCredentials: true },
        ),
      );
      this.setCsrfToken(response);
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
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'auth/password'),
          input.data,
          { withCredentials: true },
        ),
      );
      this.setCsrfToken(response);
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
      this.http.post<ApiResponse<null>>(
        this.appService.getApiUrl('v1', 'auth/logout'),
        {},
        { withCredentials: true },
      ),
    );
    this.user.set(null);
    this.onboardingActive.set(false);
    this.csrf.clear();
  }

  finishOnboarding(): void {
    this.onboardingActive.set(false);
    this.setupStatus.update((status) =>
      status ? { ...status, onboardingRequired: false, onboardingCompleted: true } : status,
    );
    this.error.set(null);
  }

  private setCsrfToken(response: { csrfToken?: unknown }): void {
    const parsed = CsrfTokenSchema.safeParse(response.csrfToken);
    this.csrf.setToken(parsed.success ? parsed.data : null);
  }

  private getErrorMessage(
    error: unknown,
    unauthorizedMessage = 'Invalid username or password.',
  ): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return unauthorizedMessage;
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The server could not be reached. Please try again.';
  }
}
