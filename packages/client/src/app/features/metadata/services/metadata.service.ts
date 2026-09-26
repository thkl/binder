import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  CreateVocabularyItem,
  CreateVocabularyItemSchema,
  DocumentMetadata,
  DocumentMetadataSchema,
  SetDocumentMetadataInput,
  SetDocumentMetadataInputSchema,
  VocabularyResponse,
  VocabularyResponseSchema
} from '@binder/common';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MetadataService {
  readonly vocabulary = signal<VocabularyResponse | null>(null);
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
        this.http.get<ApiResponse<unknown>>(`${this.apiUrl}/vocabulary`, { withCredentials: true })
      );
      const vocabulary = VocabularyResponseSchema.parse(response.data);
      this.vocabulary.set(vocabulary);
      return vocabulary;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async create(kind: 'document-types' | 'categories' | 'tags', input: CreateVocabularyItem): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const payload = CreateVocabularyItemSchema.parse(input);
      await firstValueFrom(this.http.post<ApiResponse<unknown>>(`${this.apiUrl}/vocabulary/${kind}`, payload, {
        withCredentials: true
      }));
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
        this.http.get<ApiResponse<unknown>>(`/api/v1/documents/${uuid}/metadata`, { withCredentials: true })
      );
      return DocumentMetadataSchema.parse(response.data);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    }
  }

  async setDocumentMetadata(uuid: string, input: SetDocumentMetadataInput): Promise<DocumentMetadata | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(`/api/v1/documents/${uuid}/metadata`, SetDocumentMetadataInputSchema.parse(input), {
          withCredentials: true
        })
      );
      return DocumentMetadataSchema.parse(response.data);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) return 'Your session has expired. Please sign in again.';
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') return error.error.message;
    return 'The metadata could not be updated. Please try again.';
  }
}
