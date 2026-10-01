import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ApiResponse,
  DocumentAnalysisFollowUpSchema,
  DocumentAnalysisPromptSchema,
  DocumentAnalysisResponse,
  DocumentAnalysisResponseSchema,
  DocumentAnalysisSessionState,
  DocumentAnalysisSessionStateSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class DocumentAnalysisService {
  private readonly http = inject(HttpClient);
  private readonly application = inject(ApplicationService);

  async start(
    documentUuid: string,
    prompt: string,
    forceNew = false,
  ): Promise<DocumentAnalysisResponse> {
    const input = DocumentAnalysisPromptSchema.parse({ prompt, forceNew });
    const response = await firstValueFrom(
      this.http.post<ApiResponse<unknown>>(
        this.application.getApiUrl('v1', `documents/${documentUuid}/analysis`),
        input,
        { withCredentials: true },
      ),
    );
    return DocumentAnalysisResponseSchema.parse(response.data);
  }

  async load(documentUuid: string): Promise<DocumentAnalysisSessionState | null> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(
        this.application.getApiUrl('v1', `documents/${documentUuid}/analysis`),
        { withCredentials: true },
      ),
    );
    return response.data === null ? null : DocumentAnalysisSessionStateSchema.parse(response.data);
  }

  async continue(
    documentUuid: string,
    sessionUuid: string,
    prompt: string,
  ): Promise<DocumentAnalysisResponse> {
    const input = DocumentAnalysisFollowUpSchema.parse({ sessionUuid, prompt });
    const response = await firstValueFrom(
      this.http.post<ApiResponse<unknown>>(
        this.application.getApiUrl('v1', `documents/${documentUuid}/analysis/messages`),
        input,
        { withCredentials: true },
      ),
    );
    return DocumentAnalysisResponseSchema.parse(response.data);
  }

  errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The document could not be analyzed.';
  }
}
