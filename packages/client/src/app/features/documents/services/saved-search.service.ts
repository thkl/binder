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

/** Loads and persists named document searches for the current user. */
@Injectable({ providedIn: 'root' })
export class SavedSearchService {
  readonly items = signal<SavedSearch[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * Injects the API client and URL builder used by saved-search requests.
   *
   * @param {HttpClient} http - HTTP client used to call the API.
   * @param {ApplicationService} application - Application configuration or URL service used by this request.
   */
  constructor(
    private readonly http: HttpClient,
    private readonly application: ApplicationService,
  ) {}

  /**
   * Loads and validates the user's saved searches.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
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

  /**
   * Validates and creates a saved search, keeping the local list alphabetized.
   *
   * @param {CreateSavedSearchInput} input - Validated input describing the requested operation.
   * @returns {Promise<SavedSearch | null>} - Validates and creates a saved search, keeping the local list alphabetized.
   */
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

  /**
   * Updates a saved search and replaces its local record after server confirmation.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {UpdateSavedSearchInput} input - Validated input describing the requested operation.
   * @returns {Promise<SavedSearch | null>} - Updates a saved search and replaces its local record after server confirmation.
   */
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

  /**
   * Deletes a saved search and removes it from the local list.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
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

  /**
   * Converts conflict and API errors to readable saved-search feedback.
   *
   * @param {unknown} error - Error value to handle or convert into a user-facing message.
   * @returns {string} - Converts conflict and API errors to readable saved-search feedback.
   */
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
