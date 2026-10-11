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

/** Owns browser authentication state, setup flow, and CSRF token updates. */
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

  /**
   * Injects the API client and the CSRF token store used for mutating requests.
   *
   * @param {HttpClient} http - HTTP client used to call the API.
   * @param {CsrfService} csrf - CSRF service used to validate browser requests.
   */
  constructor(
    private readonly http: HttpClient,
    private readonly csrf: CsrfService,
  ) {}

  /**
   * Restores setup state and the current cookie session during application startup.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
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

  /**
   * Creates the initial administrator and starts the onboarding session.
   *
   * @param {string} setupSecret - Secret required to initialize the administrator account.
   * @param {string} username - Username associated with the account.
   * @param {string} password - Password used to encrypt or decrypt the backup.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
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

  /**
   * Reports whether SSO is configured on the connected server.
   *
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async isSSOActive(): Promise<boolean> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<SSOActiveResponse>>(
        this.appService.getApiUrl('v1', 'ssoauth/active'),
      ),
    );
    return response.data.isActive;
  }

  /**
   * Authenticates with username and password and stores the resulting session user.
   *
   * @param {string} username - Username associated with the account.
   * @param {string} password - Password used to encrypt or decrypt the backup.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
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

  /**
   * Changes the current user's password and refreshes the authenticated user state.
   *
   * @param {string} currentPassword - Current password used to authorize the password change.
   * @param {string} newPassword - New password to save.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
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

  /**
   * Ends the current server session and clears local authentication state.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
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

  /**
   * Marks first-run onboarding complete in the client state.
   *
   * @returns {void} - No value.
   */
  finishOnboarding(): void {
    this.onboardingActive.set(false);
    this.setupStatus.update((status) =>
      status ? { ...status, onboardingRequired: false, onboardingCompleted: true } : status,
    );
    this.error.set(null);
  }

  /**
   * Validates and stores a CSRF token included in an API response.
   *
   * @param {{ csrfToken?: unknown }} response - HTTP response to populate with headers or content.
   * @returns {void} - No value.
   */
  private setCsrfToken(response: { csrfToken?: unknown }): void {
    const parsed = CsrfTokenSchema.safeParse(response.csrfToken);
    this.csrf.setToken(parsed.success ? parsed.data : null);
  }

  /**
   * Converts API validation and network errors into an authentication message.
   *
   * @param {unknown} error - Error value to handle or convert into a user-facing message.
   * @param {string} unauthorizedMessage - Message returned when authentication is rejected.
   * @returns {string} - Converts API validation and network errors into an authentication message.
   */
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
