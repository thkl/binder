import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  DocumentSearchQuerySchema,
  DocumentSearchResponse,
  DocumentSearchResponseSchema,
  Issuer,
  IssuerListResponseSchema,
  VocabularyResponse,
  VocabularyResponseSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

/** Loads search filters and submits text/semantic document searches. */
@Injectable({ providedIn: 'root' })
export class SearchService {
  readonly result = signal<DocumentSearchResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly vocabulary = signal<VocabularyResponse | null>(null);
  readonly issuers = signal<Issuer[]>([]);

  /**
   * Injects API access and loads the filter vocabularies at service startup.
   *
   * @param {HttpClient} http - HTTP client used to call the API.
   * @param {ApplicationService} appService - Application service used to construct API URLs.
   */
  constructor(
    private readonly http: HttpClient,
    private readonly appService: ApplicationService,
  ) {
    void this.loadVocabulary();
  }

  /**
   * Loads document type/category vocabulary before loading issuer filters.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async loadVocabulary(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'metadata/vocabulary'),
          { withCredentials: true },
        ),
      );
      this.vocabulary.set(VocabularyResponseSchema.parse(response.data));
      await this.loadIssuers();
    } catch {
      this.vocabulary.set(null);
    }
  }

  /**
   * Loads issuer choices used to narrow search results.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async loadIssuers(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>('/api/v1/issuers', { withCredentials: true }),
      );
      this.issuers.set(IssuerListResponseSchema.parse(response.data).items);
    } catch {
      this.issuers.set([]);
    }
  }

  /**
   * Validates filters, calls document search, and stores results or a UI error.
   *
   * @param {string} query - Validated search or document-list criteria.
   * @param {{
   * documentTypeUuid?: string;
   * categoryUuid?: string;
   * issuerUuid?: string;
   * tagUuids?: string[];
   * semanticThreshold?: number;
   * }} filters - Optional filters to apply to the search.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async search(
    query: string,
    filters: {
      documentTypeUuid?: string;
      categoryUuid?: string;
      issuerUuid?: string;
      tagUuids?: string[];
      semanticThreshold?: number;
    } = {},
  ): Promise<void> {
    const parsed = DocumentSearchQuerySchema.safeParse({
      q: query,
      limit: 20,
      semanticThreshold: 0.35,
      ...filters,
    });
    if (!parsed.success) {
      this.result.set(null);
      this.error.set(null);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    try {
      const params = new URLSearchParams({ q: parsed.data.q, limit: String(parsed.data.limit) });
      params.set('semanticThreshold', String(parsed.data.semanticThreshold));
      if (parsed.data.documentTypeUuid)
        params.set('documentTypeUuid', parsed.data.documentTypeUuid);
      if (parsed.data.categoryUuid) params.set('categoryUuid', parsed.data.categoryUuid);
      if (parsed.data.issuerUuid) params.set('issuerUuid', parsed.data.issuerUuid);
      if (parsed.data.tagUuids?.length) params.set('tagUuids', parsed.data.tagUuids.join(','));
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(
          this.appService.getApiUrl('v1', 'documents/search', `?${params.toString()}`),
          {
            withCredentials: true,
          },
        ),
      );
      this.result.set(DocumentSearchResponseSchema.parse(response.data));
    } catch (error) {
      this.result.set(null);
      this.error.set(
        error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
          ? error.error.message
          : 'The search could not be completed. Please try again.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
