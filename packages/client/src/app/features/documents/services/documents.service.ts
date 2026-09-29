import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  DocumentBulkActionInput,
  DocumentBulkActionResponse,
  DocumentBulkActionResponseSchema,
  DocumentListFacetsResponse,
  DocumentListFacetsResponseSchema,
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
  readonly facets = signal<DocumentListFacetsResponse | null>(null);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly appService = inject(ApplicationService);
  private currentQuery = DocumentListQuerySchema.parse({});

  constructor(private readonly http: HttpClient) {}

  async load(query: Partial<DocumentListQuery> = {}): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const schemaQuery = { ...this.currentQuery, ...query };
    const parsed = DocumentListQuerySchema.parse(schemaQuery);
    this.currentQuery = parsed;

    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'documents', `?${this.buildParams(parsed).toString()}`),
          { withCredentials: true }
        )
      );
      const page = DocumentListResponseSchema.parse(response.data);
      this.page.set(page);
      await this.loadFacets(parsed);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadFacets(query: DocumentListQuery): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'documents/facets', `?${this.buildParams(query, false).toString()}`),
          { withCredentials: true }
        )
      );
      this.facets.set(DocumentListFacetsResponseSchema.parse(response.data));
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    }
  }

  private buildParams(query: DocumentListQuery, includePagination = true): URLSearchParams {
    const params = new URLSearchParams();
    if (includePagination) {
      params.set('page', String(query.page));
      params.set('pageSize', String(query.pageSize));
      params.set('sort', query.sort);
      params.set('direction', query.direction);
      params.set('groupBy', query.groupBy);
      params.set('groupDirection', query.groupDirection);
    }

    if (query.status) params.set('status', query.status);
    if (query.issuerUuid) params.set('issuerUuid', query.issuerUuid);
    if (query.folderUuid) params.set('folderUuid', query.folderUuid);
    if (query.q) params.set('q', query.q);
    this.setArrayParam(params, 'documentTypeUuids', query.documentTypeUuids);
    this.setArrayParam(params, 'categoryUuids', query.categoryUuids);
    this.setArrayParam(params, 'issuerUuids', query.issuerUuids);
    this.setArrayParam(params, 'tagUuids', query.tagUuids);
    this.setArrayParam(params, 'statuses', query.statuses);
    this.setArrayParam(params, 'reviewStates', query.reviewStates);
    return params;
  }

  private setArrayParam(params: URLSearchParams, key: string, values: string[] | undefined): void {
    if (values !== undefined) params.set(key, values.join(','));
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
