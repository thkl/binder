import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  DocumentListQuery,
  DocumentListQuerySchema,
  DocumentListResponse,
  DocumentListResponseSchema,
  SetDocumentTitleInputSchema
} from '@binder/common';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DocumentsService {
  readonly page = signal<DocumentListResponse | null>(null);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);

  private readonly apiUrl = '/api/v1/documents';

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
        this.http.get<ApiResponse<unknown>>(`${this.apiUrl}?${params.toString()}`, { withCredentials: true })
      );
      this.page.set(DocumentListResponseSchema.parse(response.data));
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async requeueDocument(uuid:string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(`${this.apiUrl}/${uuid}/pipeline/requeue`, {}, { withCredentials: true })
      );
      await this.load();
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
    return this.error() === null;
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
        this.http.post<ApiResponse<unknown>>(`${this.apiUrl}/${uuid}/title`, input.data, { withCredentials: true })
      );
      await this.load();
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    }
  }

  async upload(file: File): Promise<boolean> {
    this.uploading.set(true);
    this.error.set(null);
    const body = new FormData();
    body.append('file', file, file.name);

    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(this.apiUrl, body, { withCredentials: true })
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
