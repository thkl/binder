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
  VocabularyResponse,
  VocabularyResponseSchema,
  MetadataDefinition,
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
} from '@binder/common';
import { ClearDocumentSuggestionResponseSchema } from '@binder/common';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MetadataService {
  readonly vocabulary = signal<VocabularyResponse | null>(null);
  readonly definitions = signal<MetadataDefinition[]>([]);
  readonly issuers = signal<Issuer[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  private readonly apiUrl = '/api/v1/metadata';

  constructor(private readonly http: HttpClient) {}

  async loadVocabulary(): Promise<VocabularyResponse | null> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(`${this.apiUrl}/vocabulary`, { withCredentials: true }),
      );
      const vocabulary = VocabularyResponseSchema.parse(response.data);
      this.vocabulary.set(vocabulary);
      await Promise.all([this.loadDefinitions(), this.loadIssuers()]);
      return vocabulary;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.loading.set(false);
    }
  }

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
