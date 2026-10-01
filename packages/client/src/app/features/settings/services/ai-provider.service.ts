import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  AiProviderConfiguration,
  AiProviderConfigurationSchema,
  AiProviderProfile,
  AiProviderTask,
  AiProviderTestInputSchema,
  AiProviderTestResponse,
  AiProviderTestResponseSchema,
  CreateAiProviderProfileInput,
  CreateAiProviderProfileInputSchema,
  SetAiProviderSelectionInput,
  SetAiProviderSelectionInputSchema,
  UpdateAiProviderProfileInput,
  UpdateAiProviderProfileInputSchema,
  ApiResponse,
} from '@binder/common';
import { firstValueFrom, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AiProviderService {
  readonly configuration = signal<AiProviderConfiguration | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly testing = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly testResult = signal<AiProviderTestResponse | null>(null);

  private readonly apiUrl = '/api/v1/ai/providers';

  constructor(private readonly http: HttpClient) {}

  providers(): AiProviderProfile[] {
    return this.configuration()?.items ?? [];
  }

  async load(): Promise<AiProviderConfiguration | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.apiUrl, { withCredentials: true }),
      );
      const configuration = AiProviderConfigurationSchema.parse(response.data);
      this.configuration.set(configuration);
      return configuration;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async create(input: CreateAiProviderProfileInput): Promise<AiProviderProfile | null> {
    return this.saveRequest(
      this.http.post<ApiResponse<unknown>>(
        this.apiUrl,
        CreateAiProviderProfileInputSchema.parse(input),
        { withCredentials: true },
      ),
    );
  }

  async update(
    uuid: string,
    input: UpdateAiProviderProfileInput,
  ): Promise<AiProviderProfile | null> {
    return this.saveRequest(
      this.http.patch<ApiResponse<unknown>>(
        `${this.apiUrl}/${uuid}`,
        UpdateAiProviderProfileInputSchema.parse(input),
        { withCredentials: true },
      ),
    );
  }

  async remove(uuid: string): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<null>>(`${this.apiUrl}/${uuid}`, { withCredentials: true }),
      );
      await this.load();
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async setSelection(input: SetAiProviderSelectionInput): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.put<ApiResponse<unknown>>(
          `${this.apiUrl}/selection`,
          SetAiProviderSelectionInputSchema.parse(input),
          { withCredentials: true },
        ),
      );
      this.configuration.set(AiProviderConfigurationSchema.parse(response.data));
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async test(uuid: string, task: AiProviderTask): Promise<AiProviderTestResponse | null> {
    this.testing.set(`${uuid}:${task}`);
    this.error.set(null);
    this.testResult.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          `${this.apiUrl}/${uuid}/test`,
          AiProviderTestInputSchema.parse({ task }),
          { withCredentials: true },
        ),
      );
      const result = AiProviderTestResponseSchema.parse(response.data);
      this.testResult.set(result);
      return result;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.testing.set(null);
    }
  }

  private async saveRequest(
    request: Observable<ApiResponse<unknown>>,
  ): Promise<AiProviderProfile | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(request);
      const provider = AiProviderConfigurationSchema.shape.items.element.parse(response.data);
      await this.load();
      return provider;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The AI provider operation could not be completed.';
  }
}
