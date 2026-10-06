import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  SetupCompletionResponse,
  SetupCompletionResponseSchema,
  RecoveryBackupListResponse,
  RecoveryBackupListResponseSchema,
  SetupValidationResponse,
  SetupValidationResponseSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

export type SetupValidationStep = 'storage' | 'processing' | 'oidc' | 'backup';

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

  constructor(
    private readonly http: HttpClient,
    private readonly application: ApplicationService,
  ) {}

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

  async loadRecoveryBackups(accessToken?: string): Promise<RecoveryBackupListResponse | null> {
    this.recoveryLoading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', 'setup/recovery/backups'),
          accessToken ? { accessToken } : {},
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

  validation(step: SetupValidationStep): SetupValidationResponse | null {
    return this.validations()[step];
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The setup check could not be completed. Please try again.';
  }
}
