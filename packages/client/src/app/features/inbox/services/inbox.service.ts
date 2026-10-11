import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  InboxChangeEventSchema,
  InboxAiProcessResponse,
  InboxAiProcessResponseSchema,
  InboxBulkRemoveResponseSchema,
  DocumentListResponseSchema,
  InboxRemoveResponseSchema,
  InboxQueueItem,
  InboxQueueResponseSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';

/** Tracks the inbox queue, AI processing, and live document change events. */
@Injectable({ providedIn: 'root' })
export class InboxService {
  readonly items = signal<InboxQueueItem[]>([]);
  readonly aiCandidates = signal(0);
  readonly loading = signal(false);
  readonly processing = signal(false);
  readonly error = signal<string | null>(null);
  readonly newDocumentCount = signal(0);
  readonly changedDocumentUuids = signal<string[]>([]);
  readonly documentChangeRevision = signal(0);
  private eventSource: EventSource | null = null;

  readonly activeDocuments = signal<string[]>([]);

  /**
   * Provides HTTP access for inbox and document-count requests.
   *
   * @param {HttpClient} http - HTTP client used to call the API.
   */
  constructor(private readonly http: HttpClient) {}

  /**
   * Loads the inbox queue and refreshes the count of newly added documents.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>('/api/v1/inbox', { withCredentials: true }),
      );
      const queue = InboxQueueResponseSchema.parse(response.data);
      this.items.set(queue.items);
      this.aiCandidates.set(queue.aiCandidates);
      await this.loadNewDocumentCount();
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Refreshes the count shown for documents awaiting review.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async loadNewDocumentCount(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(
          '/api/v1/documents?page=1&pageSize=1&reviewStates=new',
          { withCredentials: true },
        ),
      );
      const page = DocumentListResponseSchema.parse(response.data);
      this.newDocumentCount.set(page.total);
    } catch {
      // Keep the last known value while a count refresh is temporarily unavailable.
    }
  }

  /**
   * Records visible document IDs so live events can avoid unnecessary reloads.
   *
   * @param {string[]} uuidList - Document UUIDs currently visible in the list.
   * @returns Records visible document IDs so live events can avoid unnecessary reloads.
   */
  setActiveDocumens(uuidList: string[]) {
    this.activeDocuments.set(uuidList);
  }

  /**
   * Requests AI processing for eligible inbox items and updates the queue state.
   *
   * @returns {Promise<InboxAiProcessResponse | null>} - Requests AI processing for eligible inbox items and updates the queue state.
   */
  async processAllWithAi(): Promise<InboxAiProcessResponse | null> {
    this.processing.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          '/api/v1/inbox/ai-process',
          {},
          { withCredentials: true },
        ),
      );
      const result = InboxAiProcessResponseSchema.parse(response.data);
      this.items.set(result.items);
      this.aiCandidates.set(
        result.items.filter(
          (item) => item.status === 'imported' && ['pending', 'failed'].includes(item.aiStatus),
        ).length,
      );
      return result;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.processing.set(false);
    }
  }

  /**
   * Removes one inbox item and adjusts the AI candidate count when applicable.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async remove(uuid: string): Promise<boolean> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(`/api/v1/inbox/${uuid}`, { withCredentials: true }),
      );
      const result = InboxRemoveResponseSchema.parse(response.data);
      if (result.removed) {
        const removedItem = this.items().find((item) => item.uuid === uuid);
        this.items.update((items) => items.filter((item) => item.uuid !== uuid));
        if (
          removedItem?.status === 'imported' &&
          ['pending', 'failed'].includes(removedItem.aiStatus)
        ) {
          this.aiCandidates.update((count) => Math.max(0, count - 1));
        }
      }
      return result.removed;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return false;
    }
  }

  /**
   * Removes every duplicate or rejected item and reloads the queue when changed.
   *
   * @param {'duplicate' | 'rejected'} status - Status used to filter or update records.
   * @returns {Promise<number>} - Removes every duplicate or rejected item and reloads the queue when changed.
   */
  async removeByStatus(status: 'duplicate' | 'rejected'): Promise<number> {
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(`/api/v1/inbox/status/${status}`, {
          withCredentials: true,
        }),
      );
      const result = InboxBulkRemoveResponseSchema.parse(response.data);
      if (result.removed > 0) await this.load();
      return result.removed;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return 0;
    }
  }

  /**
   * Opens the server event stream and refreshes the inbox for relevant changes.
   *
   * @returns {void} - No value.
   */
  startLiveUpdates(): void {
    if (this.eventSource) return;
    const source = new EventSource('/api/v1/inbox/events', { withCredentials: true });
    source.onmessage = (event) => {
      try {
        const change = InboxChangeEventSchema.safeParse(JSON.parse(event.data));
        if (
          change.success &&
          change.data.type === 'inbox.changed' &&
          change.data.reason !== 'connected'
        ) {
          if (change.data.documentUuids.length > 0) {
            this.changedDocumentUuids.set(change.data.documentUuids);
          }
          this.documentChangeRevision.update((revision) => revision + 1);
          const activeList = this.activeDocuments();
          // only reload if the current document list contains at least one of the documens
          if (change.data.documentUuids.some((id) => activeList.includes(id))) {
            void this.load();
          }
        }
      } catch {
        // Ignore malformed event payloads; the next event or reconnect will recover the view.
      }
    };
    this.eventSource = source;
  }

  /**
   * Closes the live event stream when the inbox service no longer needs updates.
   *
   * @returns {void} - No value.
   */
  stopLiveUpdates(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The inbox could not be loaded. Please try again.';
  }
}
