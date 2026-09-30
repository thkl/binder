import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  CreateSavedSearchInput,
  CreateSavedSearchInputSchema,
  SavedSearch,
  SavedSearchListResponseSchema,
  UpdateSavedSearchInput,
  UpdateSavedSearchInputSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class SavedSearchService {
  readonly items = signal<SavedSearch[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly error = signal<string | null>(null);

  constructor(
    private readonly http: HttpClient,
    private readonly application: ApplicationService,
  ) {}

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.application.getApiUrl('v1', 'saved-searches'), {
          withCredentials: true,
        }),
      );
      this.items.set(SavedSearchListResponseSchema.parse(response.data).items);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async create(input: CreateSavedSearchInput): Promise<SavedSearch | null> {
    const parsed = CreateSavedSearchInputSchema.safeParse(input);
    if (!parsed.success) {
      this.error.set('Please provide a name and a valid search.');
      return null;
    }

    this.saving.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', 'saved-searches'),
          parsed.data,
          { withCredentials: true },
        ),
      );
      const savedSearch = SavedSearchListResponseSchema.shape.items.element.parse(response.data);
      this.items.update((items) =>
        [...items, savedSearch].sort((left, right) => left.name.localeCompare(right.name)),
      );
      return savedSearch;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  async update(uuid: string, input: UpdateSavedSearchInput): Promise<SavedSearch | null> {
    const parsed = UpdateSavedSearchInputSchema.safeParse(input);
    if (!parsed.success) {
      this.error.set('The saved search could not be updated.');
      return null;
    }

    this.saving.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.patch<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', `saved-searches/${uuid}`),
          parsed.data,
          { withCredentials: true },
        ),
      );
      const savedSearch = SavedSearchListResponseSchema.shape.items.element.parse(response.data);
      this.items.update((items) =>
        items
          .map((item) => (item.uuid === uuid ? savedSearch : item))
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
      return savedSearch;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  async remove(uuid: string): Promise<boolean> {
    this.deleting.set(true);
    this.error.set(null);

    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', `saved-searches/${uuid}`),
          { withCredentials: true },
        ),
      );
      this.items.update((items) => items.filter((item) => item.uuid !== uuid));
      return true;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return false;
    } finally {
      this.deleting.set(false);
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 409) {
      return 'A saved search with this name already exists.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'Saved searches could not be loaded. Please try again.';
  }
}
