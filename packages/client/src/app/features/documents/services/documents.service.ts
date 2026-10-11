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
  DocumentVersionListResponseSchema,
  AssignDocumentVersionInputSchema,
  ComposeDocumentInputSchema,
  ComposeDocumentResponseSchema,
  SplitDocumentInputSchema,
  SplitDocumentResponseSchema,
  RotateDocumentInputSchema,
  RotateDocumentResponseSchema,
  SetDocumentTitleInputSchema,
  DocumentTitleSuggestion,
  DocumentTitleSuggestionSchema,
  ClearDocumentSuggestionResponseSchema,
  DocumentDeleteResponseSchema,
  DocumentOpenResponseSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';
import { InboxService } from '../../inbox/services/inbox.service';

/** Loads document lists and coordinates document actions with the API. */
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
  readonly inboxService = inject(InboxService);
  private readonly document = inject(DOCUMENT);
  private currentQuery = DocumentListQuerySchema.parse({});

  /**
   * Provides HTTP access for validated document API requests.
   *
   * @param {HttpClient} http - HTTP client used to call the API.
   */
  constructor(private readonly http: HttpClient) {}

  /**
   * Clears the duplicate-upload notice after the user has seen it.
   *
   * @returns {void} - No value.
   */
  clearUploadNotice(): void {
    this.duplicateUpload.set(false);
    this.duplicateUploadUuid.set(null);
  }

  /**
   * Returns the validated query currently used for document listing.
   *
   * @returns {DocumentListQuery} - The validated query currently used for document listing.
   */
  getCurrentQuery(): DocumentListQuery {
    return this.currentQuery;
  }

  /**
   * Builds the API URL used by the browser PDF viewer for a document.
   *
   * @param {string} documentUuid - UUID of the document.
   * @returns {string} - Builds the API URL used by the browser PDF viewer for a document.
   */
  fileUrl(documentUuid: string): string {
    return this.appService.getApiUrl('v1', `documents/${documentUuid}/file`);
  }

  /**
   * Loads a document page, then refreshes its facets and storage health information.
   *
   * @param {Partial<DocumentListQuery>} query - Validated search or document-list criteria.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
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
      this.inboxService.setActiveDocumens(page.items.map((item) => item.uuid));
      await Promise.all([this.loadFacets(parsed), this.loadStorageIssues()]);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Fetches the version history for one document.
   *
   * @param {string} documentUuid - UUID of the document.
   * @returns {Promise<BinderDocument[]>} - Fetches the version history for one document.
   */
  async loadVersions(documentUuid: string): Promise<BinderDocument[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(
        this.appService.getApiUrl('v1', `documents/${documentUuid}/versions`),
        { withCredentials: true },
      ),
    );
    return DocumentVersionListResponseSchema.parse(response.data).items;
  }

  /**
   * Marks an existing document as a version of another document.
   *
   * @param {string} documentUuid - UUID of the document.
   * @param {string} targetDocumentUuid - UUID of the target document.
   * @param {boolean} copyMetadata - Whether metadata should be copied to the resulting document.
   * @returns {Promise<BinderDocument>} - Marks an existing document as a version of another document.
   */
  async assignAsVersion(
    documentUuid: string,
    targetDocumentUuid: string,
    copyMetadata = false,
  ): Promise<BinderDocument> {
    const input = AssignDocumentVersionInputSchema.parse({ targetDocumentUuid, copyMetadata });
    const response = await firstValueFrom(
      this.http.post<ApiResponse<unknown>>(
        this.appService.getApiUrl('v1', `documents/${documentUuid}/version`),
        input,
        { withCredentials: true },
      ),
    );
    return DocumentSchema.parse(response.data);
  }

  /**
   * Splits a PDF after the selected page and refreshes the current list on success.
   *
   * @param {string} documentUuid - UUID of the document.
   * @param {number} splitAfterPage - Page after which to split the source PDF.
   * @param {boolean} autoApplySuggestions - Whether AI suggestions should be applied to the new document.
   * @returns {Promise<{ remainingDocument: BinderDocument; extractedDocument: BinderDocument } | null>} - Splits a PDF after the selected page and refreshes the current list on success.
   */
  async splitDocument(
    documentUuid: string,
    splitAfterPage: number,
    autoApplySuggestions: boolean,
  ): Promise<{ remainingDocument: BinderDocument; extractedDocument: BinderDocument } | null> {
    this.error.set(null);
    try {
      const input = SplitDocumentInputSchema.parse({
        splitAfterPage,
        autoApplySuggestions,
      });
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${documentUuid}/split`),
          input,
          { withCredentials: true },
        ),
      );
      const result = SplitDocumentResponseSchema.parse(response.data);
      await this.load();
      return result;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  /**
   * Inserts one PDF into another at the requested page and refreshes the current list.
   *
   * @param {string} targetDocumentUuid - UUID of the target document.
   * @param {string} sourceDocumentUuid - UUID of the source document.
   * @param {number} insertAfterPage - Target page after which source PDF pages are inserted.
   * @param {boolean} copyMetadata - Whether metadata should be copied to the resulting document.
   * @param {boolean} autoApplySuggestions - Whether AI suggestions should be applied to the new document.
   * @returns {Promise<BinderDocument | null>} - Inserts one PDF into another at the requested page and refreshes the current list.
   */
  async composeDocument(
    targetDocumentUuid: string,
    sourceDocumentUuid: string,
    insertAfterPage: number,
    copyMetadata: boolean,
    autoApplySuggestions: boolean,
  ): Promise<BinderDocument | null> {
    this.error.set(null);
    try {
      const input = ComposeDocumentInputSchema.parse({
        sourceDocumentUuid,
        insertAfterPage,
        copyMetadata,
        autoApplySuggestions,
      });
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${targetDocumentUuid}/compose`),
          input,
          { withCredentials: true },
        ),
      );
      const result = ComposeDocumentResponseSchema.parse(response.data);
      await this.load();
      return result.document;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  /**
   * Rotates one page and refreshes the current document list.
   *
   * @param {string} documentUuid - UUID of the source document.
   * @param {number} pageNumber - One-based page number to rotate.
   * @param {-90 | 90 | 180} rotationDegrees - Clockwise or counter-clockwise turn.
   * @returns {Promise<BinderDocument | null>} - The new version or null on failure.
   */
  async rotatePage(
    documentUuid: string,
    pageNumber: number,
    rotationDegrees: -90 | 90 | 180,
  ): Promise<BinderDocument | null> {
    this.error.set(null);
    try {
      const input = RotateDocumentInputSchema.parse({ pageNumber, rotationDegrees });
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${documentUuid}/rotate`),
          input,
          { withCredentials: true },
        ),
      );
      const result = RotateDocumentResponseSchema.parse(response.data);
      await this.load();
      return result.document;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  /**
   * Loads filter counts for the same criteria as the current document page.
   *
   * @param {DocumentListQuery} query - Validated search or document-list criteria.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
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

  /**
   * Loads storage health warnings shown alongside document results.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
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

  /**
   * Converts validated list filters into the API's query-string format.
   *
   * @param {DocumentListQuery} query - Validated search or document-list criteria.
   * @param {boolean} includePagination - Whether to include page and ordering parameters.
   * @returns {URLSearchParams} - Converts validated list filters into the API's query-string format.
   */
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

  /**
   * Encodes a list filter using the comma-separated format expected by the API.
   *
   * @param {URLSearchParams} params - URL query parameters to populate.
   * @param {string} key - Setting, header, or metadata key to read or update.
   * @param {string[] | undefined} values - Values to store, remove, or encode.
   * @returns {void} - No value.
   */
  private setArrayParam(params: URLSearchParams, key: string, values: string[] | undefined): void {
    if (values !== undefined) params.set(key, values.join(','));
  }

  /**
   * Requeues a failed document and refreshes its visible list data.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<BinderDocument | null>} - Requeues a failed document and refreshes its visible list data.
   */
  async requeueDocument(uuid: string): Promise<BinderDocument | null> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${uuid}/pipeline/requeue`),
          {},
          { withCredentials: true },
        ),
      );
      const document = DocumentSchema.parse(
        (response.data as { document?: unknown } | null)?.document,
      );
      await this.load();
      return document;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  /**
   * Requests PDF/A generation and polls until the archive is ready, failed, or timed out.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
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

      // Conversion runs asynchronously, so check for a terminal worker state
      // before giving up after this bounded wait.
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

  /**
   * Fetches and validates the latest state for a single document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<BinderDocument | null>} - Fetches and validates the latest state for a single document.
   */
  private async getDocument(uuid: string): Promise<BinderDocument | null> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.appService.getApiUrl('v1', `documents/${uuid}`), {
        withCredentials: true,
      }),
    );
    return DocumentSchema.parse(response.data);
  }

  /**
   * Loads one document and stores a readable error instead of throwing to the view.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<BinderDocument | null>} - Loads one document and stores a readable error instead of throwing to the view.
   */
  async loadDocument(uuid: string): Promise<BinderDocument | null> {
    try {
      return await this.getDocument(uuid);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  /**
   * Refreshes one document and replaces its entry in the current page.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<BinderDocument | null>} - Refreshes one document and replaces its entry in the current page.
   */
  async refreshDocument(uuid: string): Promise<BinderDocument | null> {
    const document = await this.loadDocument(uuid);
    if (document) {
      this.updateDocumentInPage(document);
    }
    return document;
  }

  /**
   * Refreshes several documents concurrently after a bulk background operation.
   *
   * @param {string[]} uuids - Resource UUIDs included in the operation.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async refreshDocuments(uuids: string[]): Promise<void> {
    await Promise.all(uuids.map((uuid) => this.refreshDocument(uuid)));
  }

  /**
   * Marks a document as opened and updates its new/unread state in the current page.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async markOpened(uuid: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', `documents/${uuid}/open`),
          {},
          { withCredentials: true },
        ),
      );
      const state = DocumentOpenResponseSchema.parse(response.data);
      this.page.update((page) =>
        page
          ? {
              ...page,
              items: page.items.map((item) =>
                item.uuid === uuid
                  ? { ...item, isNew: state.isNew, updatedAt: state.updatedAt }
                  : item,
              ),
            }
          : page,
      );
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    }
  }

  /**
   * Reloads the current page and clamps the page index if its last rows disappeared.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async refreshCurrentPage(): Promise<void> {
    await this.load();

    const page = this.page();
    if (!page || page.page <= page.totalPages) return;

    await this.load({ page: page.totalPages || 1 });
  }

  /**
   * Replaces a document row in the cached page without reloading every list facet.
   *
   * @param {BinderDocument} document - Document being read or updated.
   * @returns {void} - No value.
   */
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

  /**
   * Waits between asynchronous archive status checks.
   *
   * @param {number} milliseconds - Delay duration in milliseconds.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  /**
   * Applies a bulk document action and reloads the affected list state.
   *
   * @param {DocumentBulkActionInput} input - Validated input describing the requested operation.
   * @returns {Promise<DocumentBulkActionResponse | null>} - Applies a bulk document action and reloads the affected list state.
   */
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

  /**
   * Previews bulk metadata changes without applying them.
   *
   * @param {BulkMetadataInput} input - Validated input describing the requested operation.
   * @returns {Promise<BulkMetadataPreviewResponse | null>} - Previews bulk metadata changes without applying them.
   */
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

  /**
   * Applies bulk metadata changes and reloads the document page.
   *
   * @param {BulkMetadataInput} input - Validated input describing the requested operation.
   * @returns {Promise<BulkMetadataApplyResponse | null>} - Applies bulk metadata changes and reloads the document page.
   */
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

  /**
   * Reverts a prior bulk change set and reloads the current page.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<DocumentChangeSetRollbackResponse | null>} - Reverts a prior bulk change set and reloads the current page.
   */
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

  /**
   * Downloads a ZIP containing the selected documents.
   *
   * @param {string[]} documentUuids - Document UUIDs included in the operation.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
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

  /**
   * Downloads a ZIP containing all documents matching the supplied filters.
   *
   * @param {Partial<DocumentListQuery>} query - Validated search or document-list criteria.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
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

  /**
   * Updates one document's title and reports validation or API errors in service state.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {string} title - Title to apply or include in the notification.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
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

  /**
   * Requests an AI title suggestion and validates the returned payload.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<DocumentTitleSuggestion | null>} - Requests an AI title suggestion and validates the returned payload.
   */
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

  /**
   * Clears the saved AI suggestion for a document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean | null>} - Clears the saved AI suggestion for a document.
   */
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

  /**
   * Uploads a PDF, tracks duplicate responses, and refreshes the current list.
   *
   * @param {File} file - PDF or other file supplied for this operation.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
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

  /**
   * Detects the API's duplicate-upload response shape.
   *
   * @param {unknown} error - Error value to handle or convert into a user-facing message.
   * @returns {error is HttpErrorResponse} - Detects the API's duplicate-upload response shape.
   */
  private isDuplicateUploadError(error: unknown): error is HttpErrorResponse {
    return (
      error instanceof HttpErrorResponse &&
      error.status === 409 &&
      error.error?.code === 'DOCUMENT_DUPLICATE'
    );
  }

  /**
   * Deletes a document and refreshes the current page when removal succeeds.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
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

  /**
   * Converts HTTP or parsing failures to text suitable for document views.
   *
   * @param {unknown} error - Error value to handle or convert into a user-facing message.
   * @returns {string} - Converts HTTP or parsing failures to text suitable for document views.
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The documents could not be loaded. Please try again.';
  }

  /**
   * Creates a temporary browser download for an archive response.
   *
   * @param {HttpResponse<Blob>} response - HTTP response to populate with headers or content.
   * @param {string} fallbackFilename - Filename to use when the response has no suggested filename.
   * @returns {void} - No value.
   */
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

  /**
   * Parses a filename from Content-Disposition, including UTF-8 encoded names.
   *
   * @param {string | null} contentDisposition - Content-Disposition header to parse for a filename.
   * @returns {string | null} - Parses a filename from Content-Disposition, including UTF-8 encoded names.
   */
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
