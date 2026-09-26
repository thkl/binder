import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  DocumentSearchQuerySchema,
  DocumentSearchResponse,
  DocumentSearchResponseSchema
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class SearchService {
  readonly result = signal<DocumentSearchResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor(
    private readonly http: HttpClient,
    private readonly appService: ApplicationService
  ) {}

  async search(query: string): Promise<void> {
    const parsed = DocumentSearchQuerySchema.safeParse({ q: query, limit: 20 });
    if (!parsed.success) {
      this.result.set(null);
      this.error.set(null);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    try {
      const params = new URLSearchParams({ q: parsed.data.q, limit: String(parsed.data.limit) });
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.appService.getApiUrl('v1', 'documents/search', `?${params.toString()}`), {
          withCredentials: true
        })
      );
      this.result.set(DocumentSearchResponseSchema.parse(response.data));
    } catch (error) {
      this.result.set(null);
      this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
        ? error.error.message
        : 'The search could not be completed. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
