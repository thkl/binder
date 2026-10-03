import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  DocumentBulkActionInput,
  DocumentBulkActionResponse,
  DocumentBulkActionResponseSchema,
  BulkMetadataInput,
  BulkMetadataApplyResponse,
  BulkMetadataApplyResponseSchema,
  BulkMetadataPreviewResponse,
  BulkMetadataPreviewResponseSchema,
  DocumentChangeSetRollbackResponse,
  DocumentChangeSetRollbackResponseSchema,
  DocumentListFacetsResponse,
  DocumentListFacetsResponseSchema,
  DocumentListQuery,
  DocumentListQuerySchema,
  DocumentListResponse,
  DocumentListResponseSchema,
  DocumentExportSelectionInput,
  DocumentStorageIssue,
  DocumentStorageIssueListResponseSchema,
  Document as BinderDocument,
  DocumentSchema,
  SetDocumentTitleInputSchema,
  DocumentTitleSuggestion,
  DocumentTitleSuggestionSchema,
  ClearDocumentSuggestionResponseSchema,
  DocumentDeleteResponseSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class DocumentsService {
  readonly page = signal<DocumentListResponse | null>(null);
  readonly facets = signal<DocumentListFacetsResponse | null>(null);
  readonly storageIssues = signal<DocumentStorageIssue[]>([]);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly exporting = signal(false);
  readonly error = signal<string | null>(null);
  readonly duplicateUpload = signal(false);
  readonly duplicateUploadUuid = signal<string | null>(null);
  readonly appService = inject(ApplicationService);
  private readonly document = inject(DOCUMENT);
  private currentQuery = DocumentListQuerySchema.parse({});

  constructor(private readonly http: HttpClient) {}

  clearUploadNotice(): void {
    this.duplicateUpload.set(false);
    this.duplicateUploadUuid.set(null);
  }

  getCurrentQuery(): DocumentListQuery {
    return this.currentQuery;
  }

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
          { withCredentials: true },
        ),
      );
      const page = DocumentListResponseSchema.parse(response.data);
      this.page.set(page);
      await Promise.all([this.loadFacets(parsed), this.loadStorageIssues()]);
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
          this.appService.getApiUrl(
            'v1',
            'documents/facets',
            `?${this.buildParams(query, false).toString()}`,
          ),
          { withCredentials: true },
        ),
      );
      this.facets.set(DocumentListFacetsResponseSchema.parse(response.data));
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    }
  }

  private async loadStorageIssues(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'documents/storage-issues'),
          { withCredentials: true },
        ),
      );
      this.storageIssues.set(DocumentStorageIssueListResponseSchema.parse(response.data).items);
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
    if (query.unassigned) params.set('unassigned', 'true');
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

  async requeueDocument(uuid: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${uuid}/pipeline/requeue`),
          {},
          { withCredentials: true },
        ),
      );
      await this.load();
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
    return this.error() === null;
  }

  async generateArchive(uuid: string): Promise<boolean> {
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${uuid}/archive`),
          {},
          { withCredentials: true },
        ),
      );
      await this.load();

      for (let attempt = 0; attempt < 30; attempt += 1) {
        await this.delay(1_000);
        const document = await this.getDocument(uuid);
        if (!document) continue;
        this.updateDocumentInPage(document);
        if (document.archiveStatus === 'ready') return true;
        if (document.archiveStatus === 'failed') {
          this.error.set(
            document.archiveError
              ? `PDF/A archive generation failed: ${document.archiveError}`
              : 'PDF/A archive generation failed.',
          );
          return false;
        }
      }

      this.error.set('PDF/A archive generation is still running. Please refresh shortly.');
      return false;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    }
  }

  private async getDocument(uuid: string): Promise<BinderDocument | null> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.appService.getApiUrl('v1', `documents/${uuid}`), {
        withCredentials: true,
      }),
    );
    return DocumentSchema.parse(response.data);
  }

  async loadDocument(uuid: string): Promise<BinderDocument | null> {
    try {
      return await this.getDocument(uuid);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  async refreshDocument(uuid: string): Promise<BinderDocument | null> {
    const document = await this.loadDocument(uuid);
    if (document) {
      this.updateDocumentInPage(document);
    }
    return document;
  }

  async refreshDocuments(uuids: string[]): Promise<void> {
    await Promise.all(uuids.map((uuid) => this.refreshDocument(uuid)));
  }

  private updateDocumentInPage(document: BinderDocument): void {
    this.page.update((page) =>
      page
        ? {
            ...page,
            items: page.items.map((item) => (item.uuid === document.uuid ? document : item)),
          }
        : page,
    );
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async bulkAction(input: DocumentBulkActionInput): Promise<DocumentBulkActionResponse | null> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'documents/bulk'),
          input,
          { withCredentials: true },
        ),
      );
      const result = DocumentBulkActionResponseSchema.parse(response.data);
      await this.load();
      return result;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  async previewBulkMetadata(input: BulkMetadataInput): Promise<BulkMetadataPreviewResponse | null> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'documents/bulk-metadata/preview'),
          input,
          { withCredentials: true },
        ),
      );
      return BulkMetadataPreviewResponseSchema.parse(response.data);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  async applyBulkMetadata(input: BulkMetadataInput): Promise<BulkMetadataApplyResponse | null> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'documents/bulk-metadata'),
          input,
          { withCredentials: true },
        ),
      );
      const result = BulkMetadataApplyResponseSchema.parse(response.data);
      await this.load();
      return result;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  async rollbackChangeSet(uuid: string): Promise<DocumentChangeSetRollbackResponse | null> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/change-sets/${uuid}/rollback`),
          {},
          { withCredentials: true },
        ),
      );
      const result = DocumentChangeSetRollbackResponseSchema.parse(response.data);
      await this.load();
      return result;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  async exportSelected(documentUuids: string[]): Promise<boolean> {
    this.exporting.set(true);
    this.error.set(null);

    const input: DocumentExportSelectionInput = { documentUuids };

    try {
      const response = await firstValueFrom(
        this.http.post(this.appService.getApiUrl('v1', 'documents/export'), input, {
          observe: 'response',
          responseType: 'blob',
          withCredentials: true,
        }),
      );
      this.downloadArchive(response, 'selected-documents.zip');
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.exporting.set(false);
    }
  }

  async exportFiltered(query: Partial<DocumentListQuery> = {}): Promise<boolean> {
    this.exporting.set(true);
    this.error.set(null);

    try {
      const parsed = DocumentListQuerySchema.parse({ ...this.currentQuery, ...query });
      const response = await firstValueFrom(
        this.http.get(
          this.appService.getApiUrl(
            'v1',
            'documents/export',
            `?${this.buildParams(parsed, false).toString()}`,
          ),
          { observe: 'response', responseType: 'blob', withCredentials: true },
        ),
      );
      this.downloadArchive(response, 'filtered-documents.zip');
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.exporting.set(false);
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
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${uuid}/title`),
          input.data,
          { withCredentials: true },
        ),
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
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${uuid}/title/suggest`),
          {},
          { withCredentials: true },
        ),
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
        this.http.delete<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${uuid}/ai-suggestion`),
          { withCredentials: true },
        ),
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
        this.http.post<ApiResponse<unknown>>(this.appService.getApiUrl('v1', 'documents'), body, {
          withCredentials: true,
        }),
      );
      await this.load();
      return true;
    } catch (error) {
      if (this.isDuplicateUploadError(error)) {
        this.duplicateUpload.set(true);
        this.duplicateUploadUuid.set(
          typeof error.error?.documentUuid === 'string' ? error.error.documentUuid : null,
        );
        return false;
      }
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.uploading.set(false);
    }
  }

  private isDuplicateUploadError(error: unknown): error is HttpErrorResponse {
    return (
      error instanceof HttpErrorResponse &&
      error.status === 409 &&
      error.error?.code === 'DOCUMENT_DUPLICATE'
    );
  }

  async remove(uuid: string): Promise<boolean> {
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${uuid}`),
          { withCredentials: true },
        ),
      );
      const result = DocumentDeleteResponseSchema.parse(response.data);
      await this.load();
      return result.deleted;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
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

  private downloadArchive(response: HttpResponse<Blob>, fallbackFilename: string): void {
    if (!response.body) {
      throw new Error('The export archive was empty');
    }

    const filename =
      this.archiveFilename(response.headers.get('Content-Disposition')) ?? fallbackFilename;
    const url = URL.createObjectURL(response.body);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = filename;
    this.document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private archiveFilename(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;

    const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) return decodeURIComponent(encoded);

    return (
      contentDisposition.match(/filename="([^"]+)"/i)?.[1] ??
      contentDisposition.match(/filename=([^;]+)/i)?.[1]?.trim() ??
      null
    );
  }
}
