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

/** Reads and changes document/folder sharing grants for the current user. */
@Injectable({ providedIn: 'root' })
export class SharingService {
  readonly recipients = signal<ShareRecipient[]>([]);
  readonly documentShareCounts = signal<Record<string, number>>({});
  readonly folderShareCounts = signal<Record<string, number>>({});
  readonly error = signal<string | null>(null);
  private readonly http = inject(HttpClient);
  private readonly application = inject(ApplicationService);
  private summaryPromise: Promise<void> | null = null;

  /**
   * Loads recipient counts used as sharing indicators in owned document and folder lists.
   *
   * @param {boolean} force - Whether to bypass cached state and reload.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async loadOwnedSummary(force = false): Promise<void> {
    if (this.summaryPromise && !force) return this.summaryPromise;
    // Share counts are requested by several views; reuse one in-flight request
    // to avoid duplicate API calls while the folder and document lists render.
    this.summaryPromise = (async () => {
      try {
        const response = await firstValueFrom(
          this.http.get<ApiResponse<unknown>>(this.url('shares/summary'), {
            withCredentials: true,
          }),
        );
        const summary = OwnedShareSummarySchema.parse(response.data);
        this.documentShareCounts.set(
          Object.fromEntries(summary.documents.map((item) => [item.uuid, item.recipientCount])),
        );
        this.folderShareCounts.set(
          Object.fromEntries(summary.folders.map((item) => [item.uuid, item.recipientCount])),
        );
      } catch {
        // Sharing indicators are supplementary; keep the document and folder lists usable.
      } finally {
        this.summaryPromise = null;
      }
    })();
    return this.summaryPromise;
  }

  /**
   * Loads the users who can receive a document or folder share.
   *
   * @returns {Promise<ShareRecipient[]>} - Loads the users who can receive a document or folder share.
   */
  async listRecipients(): Promise<ShareRecipient[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url('shares/recipients'), { withCredentials: true }),
    );
    const items = ShareRecipientsResponseSchema.parse(response.data).items;
    this.recipients.set(items);
    return items;
  }

  /**
   * Lists recipients who currently have access to one document or folder.
   *
   * @param {'documents' | 'folders'} kind - Resource kind or operation type.
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<ShareGrant[]>} - Lists recipients who currently have access to one document or folder.
   */
  async listGrants(kind: 'documents' | 'folders', uuid: string): Promise<ShareGrant[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url(`shares/${kind}/${uuid}`), {
        withCredentials: true,
      }),
    );
    return ShareGrantsResponseSchema.parse(response.data).items;
  }

  /**
   * Grants a recipient access and refreshes the owner's sharing indicators.
   *
   * @param {'documents' | 'folders'} kind - Resource kind or operation type.
   * @param {string} uuid - UUID of the target document or record.
   * @param {string} recipientUuid - UUID of the share recipient.
   * @returns {Promise<ShareGrant[]>} - Grants a recipient access and refreshes the owner's sharing indicators.
   */
  async grant(
    kind: 'documents' | 'folders',
    uuid: string,
    recipientUuid: string,
  ): Promise<ShareGrant[]> {
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

  /**
   * Revokes a recipient's access and refreshes the owner's sharing indicators.
   *
   * @param {'documents' | 'folders'} kind - Resource kind or operation type.
   * @param {string} uuid - UUID of the target document or record.
   * @param {string} recipientUuid - UUID of the share recipient.
   * @returns {Promise<ShareGrant[]>} - Revokes a recipient's access and refreshes the owner's sharing indicators.
   */
  async revoke(
    kind: 'documents' | 'folders',
    uuid: string,
    recipientUuid: string,
  ): Promise<ShareGrant[]> {
    const response = await firstValueFrom(
      this.http.delete<ApiResponse<unknown>>(this.url(`shares/${kind}/${uuid}/${recipientUuid}`), {
        withCredentials: true,
      }),
    );
    const grants = ShareGrantsResponseSchema.parse(response.data).items;
    await this.loadOwnedSummary(true);
    return grants;
  }

  /**
   * Lists all documents shared with the current user.
   *
   * @returns {Promise<SharedDocument[]>} - Lists all documents shared with the current user.
   */
  async receivedDocuments(): Promise<SharedDocument[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url('documents/shared'), { withCredentials: true }),
    );
    return SharedDocumentListResponseSchema.parse(response.data).items;
  }

  /**
   * Lists shared documents that do not belong to a shared folder.
   *
   * @returns {Promise<SharedDocument[]>} - Lists shared documents that do not belong to a shared folder.
   */
  async receivedUnfiledDocuments(): Promise<SharedDocument[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url('documents/shared/unfiled'), {
        withCredentials: true,
      }),
    );
    return SharedDocumentListResponseSchema.parse(response.data).items;
  }

  /**
   * Lists folders shared with the current user.
   *
   * @returns {Promise<SharedFolder[]>} - Lists folders shared with the current user.
   */
  async receivedFolders(): Promise<SharedFolder[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url('folders/shared'), { withCredentials: true }),
    );
    return SharedFolderListResponseSchema.parse(response.data).items;
  }

  /**
   * Lists the documents accessible through one shared folder.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<SharedDocument[]>} - Lists the documents accessible through one shared folder.
   */
  async folderDocuments(uuid: string): Promise<SharedDocument[]> {
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(this.url(`folders/shared/${uuid}/documents`), {
        withCredentials: true,
      }),
    );
    return SharedDocumentListResponseSchema.parse(response.data).items;
  }

  /**
   * Builds a versioned API URL for a sharing endpoint.
   *
   * @param {string} path - Filesystem path or API route path used by this operation.
   * @returns {string} - Builds a versioned API URL for a sharing endpoint.
   */
  private url(path: string): string {
    return this.application.getApiUrl('v1', path);
  }
}
