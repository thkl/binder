import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  SetupCompletionResponse,
  SetupCompletionResponseSchema,
  RecoveryBackupListResponse,
  RecoveryBackupListResponseSchema,
  RecoveryRestoreInput,
  MaintenanceRequestResponseSchema,
  RecoveryStatusResponse,
  RecoveryStatusResponseSchema,
  SetupValidationResponse,
  SetupValidationResponseSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

export type SetupValidationStep = 'storage' | 'processing' | 'oidc' | 'backup';

/** Runs first-time setup checks and exposes recovery operations to setup screens. */
@Injectable({ providedIn: 'root' })
export class SetupService {
  readonly validations = signal<Record<SetupValidationStep, SetupValidationResponse | null>>({
    storage: null,
    processing: null,
    oidc: null,
    backup: null,
  });
  readonly validating = signal<SetupValidationStep | null>(null);
  readonly completing = signal(false);
  readonly error = signal<string | null>(null);
  readonly recoveryBackups = signal<RecoveryBackupListResponse | null>(null);
  readonly recoveryLoading = signal(false);
  readonly recoveryStatus = signal<RecoveryStatusResponse | null>(null);

  /**
   * Injects the API client and URL builder used for setup requests.
   *
   * @param {HttpClient} http - HTTP client used to call the API.
   * @param {ApplicationService} application - Application configuration or URL service used by this request.
   */
  constructor(
    private readonly http: HttpClient,
    private readonly application: ApplicationService,
  ) {}

  /**
   * Runs the selected setup check and saves its validated result.
   *
   * @param {SetupValidationStep} step - Setup validation step to run.
   * @returns {Promise<SetupValidationResponse | null>} - Runs the selected setup check and saves its validated result.
   */
  async validate(step: SetupValidationStep): Promise<SetupValidationResponse | null> {
    this.validating.set(step);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', `setup/validate-${step}`),
          {},
          { withCredentials: true },
        ),
      );
      const validation = SetupValidationResponseSchema.parse(response.data);
      this.validations.update((current) => ({ ...current, [step]: validation }));
      return validation;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    } finally {
      this.validating.set(null);
    }
  }

  /**
   * Requests server-side completion after setup requirements have been met.
   *
   * @returns {Promise<SetupCompletionResponse | null>} - Requests server-side completion after setup requirements have been met.
   */
  async complete(): Promise<SetupCompletionResponse | null> {
    this.completing.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', 'setup/complete'),
          {},
          { withCredentials: true },
        ),
      );
      return SetupCompletionResponseSchema.parse(response.data);
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    } finally {
      this.completing.set(false);
    }
  }

  /**
   * Lists local or remote recovery backups using optional provider credentials.
   *
   * @param {string} accessToken - OAuth access token for the remote provider.
   * @param {boolean} publicRecovery - Whether to use the public recovery endpoint.
   * @param {string} remoteFolder - Remote folder path to list or use as the backup destination.
   * @returns {Promise<RecoveryBackupListResponse | null>} - Lists local or remote recovery backups using optional provider credentials.
   */
  async loadRecoveryBackups(
    accessToken?: string,
    publicRecovery = false,
    remoteFolder?: string,
  ): Promise<RecoveryBackupListResponse | null> {
    this.recoveryLoading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.application.getApiUrl(
            'v1',
            publicRecovery ? 'setup/recovery/public/backups' : 'setup/recovery/backups',
          ),
          { ...(accessToken ? { accessToken } : {}), ...(remoteFolder ? { remoteFolder } : {}) },
          { withCredentials: true },
        ),
      );
      const backups = RecoveryBackupListResponseSchema.parse(response.data);
      this.recoveryBackups.set(backups);
      return backups;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    } finally {
      this.recoveryLoading.set(false);
    }
  }

  /**
   * Queues a restore from the selected backup and returns its maintenance request ID.
   *
   * @param {RecoveryRestoreInput} input - Validated input describing the requested operation.
   * @param {boolean} publicRecovery - Whether to use the public recovery endpoint.
   * @returns {Promise<string | null>} - Queues a restore from the selected backup and returns its maintenance request ID.
   */
  async requestRecoveryRestore(
    input: RecoveryRestoreInput,
    publicRecovery = false,
  ): Promise<string | null> {
    this.recoveryLoading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.application.getApiUrl(
            'v1',
            publicRecovery ? 'setup/recovery/public/restore' : 'setup/recovery/restore',
          ),
          input,
          { withCredentials: true },
        ),
      );
      return MaintenanceRequestResponseSchema.parse(response.data).uuid;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    } finally {
      this.recoveryLoading.set(false);
    }
  }

  /**
   * Loads public recovery status for display while setup or login is unavailable.
   *
   * @returns {Promise<RecoveryStatusResponse | null>} - Loads public recovery status for display while setup or login is unavailable.
   */
  async loadRecoveryStatus(): Promise<RecoveryStatusResponse | null> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', 'setup/recovery/public/status'),
          { withCredentials: true },
        ),
      );
      const status = RecoveryStatusResponseSchema.parse(response.data);
      this.recoveryStatus.set(status);
      return status;
    } catch {
      return null;
    }
  }

  /**
   * Returns the cached validation result for one setup step.
   *
   * @param {SetupValidationStep} step - Setup validation step to run.
   * @returns {SetupValidationResponse | null} - The cached validation result for one setup step.
   */
  validation(step: SetupValidationStep): SetupValidationResponse | null {
    return this.validations()[step];
  }

  /**
   * Converts API failures into readable setup-screen feedback.
   *
   * @param {unknown} error - Error value to handle or convert into a user-facing message.
   * @returns {string} - Converts API failures into readable setup-screen feedback.
   */
  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The setup check could not be completed. Please try again.';
  }
}
