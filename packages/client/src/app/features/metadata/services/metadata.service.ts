import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  CreateVocabularyItem,
  CreateVocabularyItemSchema,
  UpdateVocabularyItem,
  UpdateVocabularyItemSchema,
  VocabularyItem,
  VocabularyItemSchema,
  CreateMetadataDefinition,
  CreateMetadataDefinitionSchema,
  DocumentMetadata,
  DocumentMetadataSchema,
  SetDocumentMetadataInput,
  SetDocumentMetadataInputSchema,
  UpdateMetadataDefinition,
  UpdateMetadataDefinitionSchema,
  VocabularyResponse,
  VocabularyResponseSchema,
  MetadataDefinition,
  MetadataDefinitionDeleteResponseSchema,
  MetadataDefinitionSchema,
  MetadataDefinitionsResponseSchema,
  Issuer,
  IssuerListResponseSchema,
  IssuerSchema,
  CreateIssuerInput,
  CreateIssuerInputSchema,
  UpdateIssuerInput,
  UpdateIssuerInputSchema,
  DocumentExtractedTextResponse,
  DocumentExtractedTextResponseSchema,
  ClassificationFeedback,
  ClassificationFeedbackListResponseSchema,
  ClassificationFeedbackDeleteResponseSchema,
} from '@binder/common';
import { ClearDocumentSuggestionResponseSchema } from '@binder/common';
import { firstValueFrom } from 'rxjs';

/** Loads and persists metadata vocabularies, issuers, definitions, and document metadata. */
@Injectable({ providedIn: 'root' })
export class MetadataService {
  readonly vocabulary = signal<VocabularyResponse | null>(null);
  readonly definitions = signal<MetadataDefinition[]>([]);
  readonly issuers = signal<Issuer[]>([]);
  readonly feedback = signal<ClassificationFeedback[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  private readonly apiUrl = '/api/v1/metadata';

  /**
   * Provides HTTP access for metadata endpoints.
   *
   * @param {HttpClient} http - HTTP client used to call the API.
   */
  constructor(private readonly http: HttpClient) {}

  /**
   * Loads vocabulary, custom field definitions, issuers, and classification feedback.
   *
   * @returns {Promise<VocabularyResponse | null>} - Loads vocabulary, custom field definitions, issuers, and classification feedback.
   */
  async loadVocabulary(): Promise<VocabularyResponse | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(`${this.apiUrl}/vocabulary`, { withCredentials: true }),
      );
      const vocabulary = VocabularyResponseSchema.parse(response.data);
      this.vocabulary.set(vocabulary);
      await Promise.all([this.loadDefinitions(), this.loadIssuers(), this.loadFeedback()]);
      return vocabulary;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Loads server-defined custom metadata fields.
   *
   * @returns {Promise<MetadataDefinition[] | null>} - Loads server-defined custom metadata fields.
   */
  async loadDefinitions(): Promise<MetadataDefinition[] | null> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(`${this.apiUrl}/definitions`, {
          withCredentials: true,
        }),
      );
      const definitions = MetadataDefinitionsResponseSchema.parse(response.data).items;
      this.definitions.set(definitions);
      return definitions;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  /**
   * Loads issuer records used by document metadata.
   *
   * @returns {Promise<Issuer[] | null>} - Loads issuer records used by document metadata.
   */
  async loadIssuers(): Promise<Issuer[] | null> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>('/api/v1/issuers', { withCredentials: true }),
      );
      const issuers = IssuerListResponseSchema.parse(response.data).items;
      this.issuers.set(issuers);
      return issuers;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  /**
   * Loads classification feedback available for review by administrators.
   *
   * @returns {Promise<ClassificationFeedback[] | null>} - Loads classification feedback available for review by administrators.
   */
  async loadFeedback(): Promise<ClassificationFeedback[] | null> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>('/api/v1/classification-feedback', {
          withCredentials: true,
        }),
      );
      const feedback = ClassificationFeedbackListResponseSchema.parse(response.data).items;
      this.feedback.set(feedback);
      return feedback;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  /**
   * Deletes one classification feedback item and removes it from local state.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async removeFeedback(uuid: string): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(`/api/v1/classification-feedback/${uuid}`, {
          withCredentials: true,
        }),
      );
      ClassificationFeedbackDeleteResponseSchema.parse(response.data);
      this.feedback.update((items) => items.filter((item) => item.uuid !== uuid));
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Creates an issuer and reloads the issuer list after the server accepts it.
   *
   * @param {CreateIssuerInput} input - Validated input describing the requested operation.
   * @returns {Promise<Issuer | null>} - Creates an issuer and reloads the issuer list after the server accepts it.
   */
  async createIssuer(input: CreateIssuerInput): Promise<Issuer | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          '/api/v1/issuers',
          CreateIssuerInputSchema.parse(input),
          {
            withCredentials: true,
          },
        ),
      );
      const issuer = IssuerSchema.parse(response.data);
      await this.loadIssuers();
      return issuer;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Updates an issuer and reloads the issuer list to keep selectors current.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {UpdateIssuerInput} input - Validated input describing the requested operation.
   * @returns {Promise<Issuer | null>} - Updates an issuer and reloads the issuer list to keep selectors current.
   */
  async updateIssuer(uuid: string, input: UpdateIssuerInput): Promise<Issuer | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.patch<ApiResponse<unknown>>(
          `/api/v1/issuers/${uuid}`,
          UpdateIssuerInputSchema.parse(input),
          {
            withCredentials: true,
          },
        ),
      );
      const issuer = IssuerSchema.parse(response.data);
      await this.loadIssuers();
      return issuer;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Creates a custom metadata field definition.
   *
   * @param {CreateMetadataDefinition} input - Validated input describing the requested operation.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async createDefinition(input: CreateMetadataDefinition): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          `${this.apiUrl}/definitions`,
          CreateMetadataDefinitionSchema.parse(input),
          {
            withCredentials: true,
          },
        ),
      );
      await this.loadDefinitions();
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Updates the label or configuration of a custom metadata field.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {UpdateMetadataDefinition} input - Validated input describing the requested operation.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async updateDefinition(uuid: string, input: UpdateMetadataDefinition): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.patch<ApiResponse<unknown>>(
          `${this.apiUrl}/definitions/${uuid}`,
          UpdateMetadataDefinitionSchema.parse(input),
          { withCredentials: true },
        ),
      );
      MetadataDefinitionSchema.parse(response.data);
      await this.loadDefinitions();
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Deletes a custom metadata field definition.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async deleteDefinition(uuid: string): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(`${this.apiUrl}/definitions/${uuid}`, {
          withCredentials: true,
        }),
      );
      MetadataDefinitionDeleteResponseSchema.parse(response.data);
      await this.loadDefinitions();
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Creates a document type, category, or tag in the server vocabulary.
   *
   * @param {'document-types' | 'categories' | 'tags'} kind - Resource kind or operation type.
   * @param {CreateVocabularyItem} input - Validated input describing the requested operation.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async create(
    kind: 'document-types' | 'categories' | 'tags',
    input: CreateVocabularyItem,
  ): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const payload = CreateVocabularyItemSchema.parse(input);
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(`${this.apiUrl}/vocabulary/${kind}`, payload, {
          withCredentials: true,
        }),
      );
      await this.loadVocabulary();
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Updates a vocabulary item's name and localized labels.
   *
   * @param {'document-types' | 'categories' | 'tags'} kind - Resource kind or operation type.
   * @param {string} uuid - UUID of the target document or record.
   * @param {UpdateVocabularyItem} input - Validated input describing the requested operation.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async updateVocabulary(
    kind: 'document-types' | 'categories' | 'tags',
    uuid: string,
    input: UpdateVocabularyItem,
  ): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const payload = UpdateVocabularyItemSchema.parse(input);
      await firstValueFrom(
        this.http.patch<ApiResponse<unknown>>(
          `${this.apiUrl}/vocabulary/${kind}/${uuid}`,
          payload,
          {
            withCredentials: true,
          },
        ),
      );
      await this.loadVocabulary();
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Copies a vocabulary item into the selected scope.
   *
   * @param {'document-types' | 'categories'} kind - Resource kind or operation type.
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<VocabularyItem | null>} - Copies a vocabulary item into the selected scope.
   */
  async cloneVocabulary(
    kind: 'document-types' | 'categories',
    uuid: string,
  ): Promise<VocabularyItem | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          `${this.apiUrl}/vocabulary/${kind}/${uuid}/clone`,
          {},
          {
            withCredentials: true,
          },
        ),
      );
      const item = VocabularyItemSchema.parse(response.data);
      await this.loadVocabulary();
      return item;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Deletes a document type or category vocabulary item.
   *
   * @param {'document-types' | 'categories'} kind - Resource kind or operation type.
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async deleteVocabulary(kind: 'document-types' | 'categories', uuid: string): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(`${this.apiUrl}/vocabulary/${kind}/${uuid}`, {
          withCredentials: true,
        }),
      );
      await this.loadVocabulary();
      return true;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Loads the editable metadata record for a document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<DocumentMetadata | null>} - Loads the editable metadata record for a document.
   */
  async getDocumentMetadata(uuid: string): Promise<DocumentMetadata | null> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(`/api/v1/documents/${uuid}/metadata`, {
          withCredentials: true,
        }),
      );
      return DocumentMetadataSchema.parse(response.data);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  /**
   * Loads OCR text and extraction details shown in the document editor.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<DocumentExtractedTextResponse | null>} - Loads OCR text and extraction details shown in the document editor.
   */
  async getExtractedText(uuid: string): Promise<DocumentExtractedTextResponse | null> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(`/api/v1/documents/${uuid}/extracted-text`, {
          withCredentials: true,
        }),
      );
      return DocumentExtractedTextResponseSchema.parse(response.data);
    } catch (error) {
      return null;
    }
  }

  /**
   * Validates and saves document metadata, returning the updated server record.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {SetDocumentMetadataInput} input - Validated input describing the requested operation.
   * @returns {Promise<DocumentMetadata | null>} - Validates and saves document metadata, returning the updated server record.
   */
  async setDocumentMetadata(
    uuid: string,
    input: SetDocumentMetadataInput,
  ): Promise<DocumentMetadata | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          `/api/v1/documents/${uuid}/metadata`,
          SetDocumentMetadataInputSchema.parse(input),
          {
            withCredentials: true,
          },
        ),
      );
      return DocumentMetadataSchema.parse(response.data);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Dismisses the pending metadata suggestion for one document.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean | null>} - Dismisses the pending metadata suggestion for one document.
   */
  async clearDocumentSuggestion(uuid: string): Promise<boolean | null> {
    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(`/api/v1/documents/${uuid}/ai-suggestion`, {
          withCredentials: true,
        }),
      );
      return ClearDocumentSuggestionResponseSchema.parse(response.data).cleared;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401)
      return 'Your session has expired. Please sign in again.';
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string')
      return error.error.message;
    return 'The metadata could not be updated. Please try again.';
  }
}
