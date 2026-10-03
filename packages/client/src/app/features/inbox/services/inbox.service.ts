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

@Injectable({ providedIn: 'root' })
export class InboxService {
  readonly items = signal<InboxQueueItem[]>([]);
  readonly aiCandidates = signal(0);
  readonly loading = signal(false);
  readonly processing = signal(false);
  readonly error = signal<string | null>(null);
  readonly newDocumentCount = signal(0);
  private eventSource: EventSource | null = null;

  constructor(private readonly http: HttpClient) {}

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
          void this.load();
        }
      } catch {
        // Ignore malformed event payloads; the next event or reconnect will recover the view.
      }
    };
    this.eventSource = source;
  }

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
