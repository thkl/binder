import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  DocumentBulkActionInput,
  DocumentBulkActionResponse,
  DocumentBulkActionResponseSchema,
  DocumentListQuery,
  DocumentListQuerySchema,
  DocumentListResponse,
  DocumentListResponseSchema,
  SetDocumentTitleInputSchema,
  DocumentTitleSuggestion,
  DocumentTitleSuggestionSchema,
  ClearDocumentSuggestionResponseSchema
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class DocumentsService {
  readonly page = signal<DocumentListResponse | null>(null);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly appService = inject(ApplicationService);

  constructor(private readonly http: HttpClient) {}

  async load(query: Partial<DocumentListQuery> = {}): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const parsed = DocumentListQuerySchema.parse(query);
    const params = new URLSearchParams({
      page: String(parsed.page),
      pageSize: String(parsed.pageSize),
      sort: parsed.sort,
      direction: parsed.direction
    });
    if (parsed.status) params.set('status', parsed.status);
    if (parsed.q) params.set('q', parsed.q);

    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.appService.getApiUrl('v1','documents',`?${params.toString()}`), { withCredentials: true })
      );
      const page = DocumentListResponseSchema.parse(response.data);
      this.page.set(page);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async requeueDocument(uuid:string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(this.appService.getApiUrl('v1',`documents/${uuid}/pipeline/requeue`) , {}, { withCredentials: true })
      );
      await this.load();
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
    return this.error() === null;
  }

  async bulkAction(input: DocumentBulkActionInput): Promise<DocumentBulkActionResponse | null> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'documents/bulk'),
          input,
          { withCredentials: true }
        )
      );
      const result = DocumentBulkActionResponseSchema.parse(response.data);
      await this.load();
      return result;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  async updateTitle(uuid: string, title: string): Promise<boolean> {
    const input = SetDocumentTitleInputSchema.safeParse({ title });
    if (!input.success) {
      this.error.set('A document title is required and may contain at most 255 characters.');
      return false;
    }
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(this.appService.getApiUrl('v1', `documents/${uuid}/title`), input.data, { withCredentials: true })
      );
      await this.load();
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    }
  }

  async suggestTitle(uuid: string): Promise<DocumentTitleSuggestion | null> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(this.appService.getApiUrl('v1', `documents/${uuid}/title/suggest`), {}, { withCredentials: true })
      );
      return DocumentTitleSuggestionSchema.parse(response.data);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  async clearSuggestion(uuid: string): Promise<boolean | null> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(this.appService.getApiUrl('v1', `documents/${uuid}/ai-suggestion`), { withCredentials: true })
      );
      return ClearDocumentSuggestionResponseSchema.parse(response.data).cleared;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  async upload(file: File): Promise<boolean> {
    this.uploading.set(true);
    this.error.set(null);
    const body = new FormData();
    body.append('file', file, file.name);

    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(this.appService.getApiUrl('v1','documents'), body, { withCredentials: true })
      );
      await this.load();
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.uploading.set(false);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The documents could not be loaded. Please try again.';
  }
}
