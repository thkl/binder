import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import {
  ApiResponse,
  OwnedShareSummarySchema,
  ShareGrantsResponseSchema,
  ShareRecipientsResponseSchema,
  SharedDocumentListResponseSchema,
  SharedFolderListResponseSchema,
  type ShareGrant,
  type ShareRecipient,
  type SharedDocument,
  type SharedFolder,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class SharingService {
  readonly recipients = signal<ShareRecipient[]>([]);
  readonly documentShareCounts = signal<Record<string, number>>({});
  readonly folderShareCounts = signal<Record<string, number>>({});
  readonly error = signal<string | null>(null);
  private readonly http = inject(HttpClient);
  private readonly application = inject(ApplicationService);
  private summaryPromise: Promise<void> | null = null;

  async loadOwnedSummary(force = false): Promise<void> {
    if (this.summaryPromise && !force) return this.summaryPromise;
    this.summaryPromise = (async () => {
      try {
        const response = await firstValueFrom(
          this.http.get<ApiResponse<unknown>>(this.url('shares/summary'), { withCredentials: true }),
        );
        const summary = OwnedShareSummarySchema.parse(response.data);
        this.documentShareCounts.set(Object.fromEntries(summary.documents.map((item) => [item.uuid, item.recipientCount])));
        this.folderShareCounts.set(Object.fromEntries(summary.folders.map((item) => [item.uuid, item.recipientCount])));
      } catch {
        // Sharing indicators are supplementary; keep the document and folder lists usable.
      } finally {
        this.summaryPromise = null;
      }
    })();
    return this.summaryPromise;
  }

  async listRecipients(): Promise<ShareRecipient[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url('shares/recipients'), { withCredentials: true }),
    );
    const items = ShareRecipientsResponseSchema.parse(response.data).items;
    this.recipients.set(items);
    return items;
  }

  async listGrants(kind: 'documents' | 'folders', uuid: string): Promise<ShareGrant[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url(`shares/${kind}/${uuid}`), { withCredentials: true }),
    );
    return ShareGrantsResponseSchema.parse(response.data).items;
  }

  async grant(kind: 'documents' | 'folders', uuid: string, recipientUuid: string): Promise<ShareGrant[]> {
    const response = await firstValueFrom(
      this.http.post<ApiResponse<unknown>>(
        this.url(`shares/${kind}/${uuid}`),
        { recipientUuid },
        { withCredentials: true },
      ),
    );
    const grants = ShareGrantsResponseSchema.parse(response.data).items;
    await this.loadOwnedSummary(true);
    return grants;
  }

  async revoke(kind: 'documents' | 'folders', uuid: string, recipientUuid: string): Promise<ShareGrant[]> {
    const response = await firstValueFrom(
      this.http.delete<ApiResponse<unknown>>(
        this.url(`shares/${kind}/${uuid}/${recipientUuid}`),
        { withCredentials: true },
      ),
    );
    const grants = ShareGrantsResponseSchema.parse(response.data).items;
    await this.loadOwnedSummary(true);
    return grants;
  }

  async receivedDocuments(): Promise<SharedDocument[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url('documents/shared'), { withCredentials: true }),
    );
    return SharedDocumentListResponseSchema.parse(response.data).items;
  }

  async receivedUnfiledDocuments(): Promise<SharedDocument[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url('documents/shared/unfiled'), { withCredentials: true }),
    );
    return SharedDocumentListResponseSchema.parse(response.data).items;
  }

  async receivedFolders(): Promise<SharedFolder[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url('folders/shared'), { withCredentials: true }),
    );
    return SharedFolderListResponseSchema.parse(response.data).items;
  }

  async folderDocuments(uuid: string): Promise<SharedDocument[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url(`folders/shared/${uuid}/documents`), { withCredentials: true }),
    );
    return SharedDocumentListResponseSchema.parse(response.data).items;
  }

  private url(path: string): string {
    return this.application.getApiUrl('v1', path);
  }
}
