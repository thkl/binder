import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  InboxChangeEventSchema,
  InboxAiProcessResponse,
  InboxAiProcessResponseSchema,
  InboxQueueItem,
  InboxQueueResponseSchema
} from '@binder/common';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class InboxService {
  readonly items = signal<InboxQueueItem[]>([]);
  readonly aiCandidates = signal(0);
  readonly loading = signal(false);
  readonly processing = signal(false);
  readonly error = signal<string | null>(null);
  private eventSource: EventSource | null = null;

  constructor(private readonly http: HttpClient) {}

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>('/api/v1/inbox', { withCredentials: true })
      );
      const queue = InboxQueueResponseSchema.parse(response.data);
      this.items.set(queue.items);
      this.aiCandidates.set(queue.aiCandidates);
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async processAllWithAi(): Promise<InboxAiProcessResponse | null> {
    this.processing.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>('/api/v1/inbox/ai-process', {}, { withCredentials: true })
      );
      const result = InboxAiProcessResponseSchema.parse(response.data);
      this.items.set(result.items);
      this.aiCandidates.set(result.items.filter((item) => item.status === 'imported' && ['pending', 'failed'].includes(item.aiStatus)).length);
      return result;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.processing.set(false);
    }
  }

  startLiveUpdates(): void {
    if (this.eventSource) return;
    const source = new EventSource('/api/v1/inbox/events', { withCredentials: true });
    source.onmessage = (event) => {
      try {
        const change = InboxChangeEventSchema.safeParse(JSON.parse(event.data));
        if (change.success && change.data.type === 'inbox.changed' && change.data.reason !== 'connected') {
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
