import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  CreateFolderInputSchema,
  FolderDocumentActionResponse,
  FolderDocumentActionResponseSchema,
  FolderDocumentListResponseSchema,
  FolderDocumentInputSchema,
  FolderListResponseSchema,
  FolderNode,
  MoveFolderInputSchema,
  UpdateFolderInputSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

export interface FolderTreeRow {
  folder: FolderNode;
  depth: number;
  expanded: boolean;
}

/** Maintains the folder tree and exposes folder CRUD and document assignment operations. */
@Injectable({ providedIn: 'root' })
export class FoldersService {
  readonly children = signal<Record<string, FolderNode[]>>({});
  readonly expanded = signal<Set<string>>(new Set());
  readonly loadedParents = signal<Set<string>>(new Set());
  readonly loadingParents = signal<Set<string>>(new Set());
  readonly allFolders = signal<FolderNode[]>([]);
  readonly error = signal<string | null>(null);
  readonly selectedFolderUuid = signal<string | null>(null);
  readonly exportingFolderUuid = signal<string | null>(null);
  readonly rows = computed<FolderTreeRow[]>(() => {
    const result: FolderTreeRow[] = [];
    const walk = (parentUuid: string | null, depth: number): void => {
      for (const folder of this.children()[this.parentKey(parentUuid)] ?? []) {
        const expanded = this.expanded().has(folder.uuid);
        result.push({ folder, depth, expanded });
        if (expanded) walk(folder.uuid, depth + 1);
      }
    };
    walk(null, 0);
    return result;
  });
  readonly loadedFolders = computed<FolderNode[]>(() => {
    const folders = new Map<string, FolderNode>();
    for (const items of Object.values(this.children())) {
      for (const folder of items) folders.set(folder.uuid, folder);
    }
    return [...folders.values()].sort((left, right) => left.name.localeCompare(right.name));
  });

  private readonly application = inject(ApplicationService);
  private readonly document = inject(DOCUMENT);

  /**
   * Provides HTTP access for folder API requests.
   *
   * @param {HttpClient} http - HTTP client used to call the API.
   */
  constructor(private readonly http: HttpClient) {}

  /**
   * Fetches one level of the tree, skipping cached or already-running requests.
   *
   * @param {string | null} parentUuid - Parent folder UUID, or null for the root folder.
   * @param {boolean} force - Whether to bypass cached state and reload.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async loadChildren(parentUuid: string | null, force = false): Promise<void> {
    const key = this.parentKey(parentUuid);
    if (!force && this.loadedParents().has(key)) return;
    if (this.loadingParents().has(key)) return;

    this.setLoading(key, true);
    this.error.set(null);
    try {
      const query = parentUuid ? `?parentUuid=${encodeURIComponent(parentUuid)}` : '';
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.application.getApiUrl('v1', `folders${query}`), {
          withCredentials: true,
        }),
      );
      const result = FolderListResponseSchema.parse(response.data);
      this.children.update((current) => ({ ...current, [key]: result.items }));
      this.loadedParents.update((current) => new Set(current).add(key));
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.setLoading(key, false);
    }
  }

  /**
   * Expands a folder by loading its children or collapses it when already open.
   *
   * @param {FolderNode} folder - Folder being processed.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async toggle(folder: FolderNode): Promise<void> {
    if (this.expanded().has(folder.uuid)) {
      this.expanded.update((current) => this.without(current, folder.uuid));
      return;
    }
    await this.loadChildren(folder.uuid);
    this.expanded.update((current) => new Set(current).add(folder.uuid));
  }

  /**
   * Loads every folder for selectors and sorts them by their full path.
   *
   * @returns {Promise<FolderNode[]>} - Loads every folder for selectors and sorts them by their full path.
   */
  async listAll(): Promise<FolderNode[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.application.getApiUrl('v1', 'folders/all'), {
          withCredentials: true,
        }),
      );
      const folders = sortFoldersByPath(
        FolderDocumentListResponseSchema.parse(response.data).items,
      );
      this.allFolders.set(folders);
      return folders;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return [];
    }
  }

  /**
   * Returns the folders currently assigned to a document.
   *
   * @param {string} documentUuid - UUID of the document.
   * @returns {Promise<FolderNode[]>} - The folders currently assigned to a document.
   */
  async listForDocument(documentUuid: string): Promise<FolderNode[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', `folders/for-document/${documentUuid}`),
          { withCredentials: true },
        ),
      );
      return FolderDocumentListResponseSchema.parse(response.data).items;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return [];
    }
  }

  /**
   * Applies the additions and removals needed to match a document's selected folders.
   *
   * @param {string} documentUuid - UUID of the document.
   * @param {string[]} selectedUuids - Folder UUIDs selected by the user.
   * @param {string[]} originalUuids - Folder UUIDs assigned before the edit.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async setDocumentFolders(
    documentUuid: string,
    selectedUuids: string[],
    originalUuids: string[],
  ): Promise<boolean> {
    const selected = new Set(selectedUuids);
    const original = new Set(originalUuids);
    const additions = [...selected].filter((uuid) => !original.has(uuid));
    const removals = [...original].filter((uuid) => !selected.has(uuid));
    const results = await Promise.all([
      ...additions.map((folderUuid) => this.linkDocuments(folderUuid, [documentUuid])),
      ...removals.map((folderUuid) => this.unlinkDocuments(folderUuid, [documentUuid])),
    ]);
    return results.every((result) => result !== null);
  }

  /**
   * Creates a child folder and refreshes its parent's cached children.
   *
   * @param {string} name - Secret, folder, or resource name to resolve or assign.
   * @param {string | null} parentUuid - Parent folder UUID, or null for the root folder.
   * @returns {Promise<FolderNode | null>} - Creates a child folder and refreshes its parent's cached children.
   */
  async create(name: string, parentUuid: string | null): Promise<FolderNode | null> {
    const input = CreateFolderInputSchema.safeParse({ name, parentUuid });
    if (!input.success) {
      this.error.set('Folder names must contain between 1 and 255 characters.');
      return null;
    }
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', 'folders'),
          input.data,
          { withCredentials: true },
        ),
      );
      const folder = FolderListResponseSchema.shape.items.element.parse(response.data);
      await this.loadChildren(parentUuid, true);
      return folder;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    }
  }

  /**
   * Renames a folder and updates the matching cached tree node.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {string} name - Secret, folder, or resource name to resolve or assign.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async rename(uuid: string, name: string): Promise<boolean> {
    const input = UpdateFolderInputSchema.safeParse({ name });
    if (!input.success) {
      this.error.set('Folder names must contain between 1 and 255 characters.');
      return false;
    }
    try {
      const response = await firstValueFrom(
        this.http.patch<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', `folders/${uuid}`),
          input.data,
          { withCredentials: true },
        ),
      );
      const updated = FolderListResponseSchema.shape.items.element.parse(response.data);
      this.replaceFolder(updated);
      return true;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return false;
    }
  }

  /**
   * Moves a folder and reloads the old and new parent lists.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {string | null} parentUuid - Parent folder UUID, or null for the root folder.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async move(uuid: string, parentUuid: string | null): Promise<boolean> {
    const input = MoveFolderInputSchema.safeParse({ parentUuid });
    if (!input.success) return false;
    const previousParentUuid = this.findFolder(uuid)?.parentUuid ?? null;
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', `folders/${uuid}/move`),
          input.data,
          { withCredentials: true },
        ),
      );
      const updated = FolderListResponseSchema.shape.items.element.parse(response.data);
      this.removeFolderFromState(uuid);
      await this.loadChildren(previousParentUuid, true);
      await this.loadChildren(updated.parentUuid, true);
      return true;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return false;
    }
  }

  /**
   * Deletes a folder and refreshes its parent's tree, clearing selection if needed.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async remove(uuid: string): Promise<boolean> {
    const parentUuid = this.findFolder(uuid)?.parentUuid ?? null;
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(
          this.application.getApiUrl('v1', `folders/${uuid}`),
          { withCredentials: true },
        ),
      );
      this.removeFolderFromState(uuid);
      await this.loadChildren(parentUuid, true);
      await this.loadChildren(null, true);
      if (this.selectedFolderUuid() === uuid) this.selectedFolderUuid.set(null);
      return true;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return false;
    }
  }

  /**
   * Selects a folder for the document list or clears the current selection.
   *
   * @param {string | null} folderUuid - UUID of the folder.
   * @returns {void} - No value.
   */
  select(folderUuid: string | null): void {
    this.selectedFolderUuid.set(folderUuid);
  }

  /**
   * Adds the specified documents to a folder.
   *
   * @param {string} folderUuid - UUID of the folder.
   * @param {string[]} documentUuids - Document UUIDs included in the operation.
   * @returns {Promise<FolderDocumentActionResponse | null>} - Adds the specified documents to a folder.
   */
  async linkDocuments(
    folderUuid: string,
    documentUuids: string[],
  ): Promise<FolderDocumentActionResponse | null> {
    return this.changeDocumentLinks(folderUuid, documentUuids, false);
  }

  /**
   * Removes the specified documents from a folder.
   *
   * @param {string} folderUuid - UUID of the folder.
   * @param {string[]} documentUuids - Document UUIDs included in the operation.
   * @returns {Promise<FolderDocumentActionResponse | null>} - Removes the specified documents from a folder.
   */
  async unlinkDocuments(
    folderUuid: string,
    documentUuids: string[],
  ): Promise<FolderDocumentActionResponse | null> {
    return this.changeDocumentLinks(folderUuid, documentUuids, true);
  }

  /**
   * Downloads a ZIP archive containing documents in the selected folder.
   *
   * @param {string} folderUuid - UUID of the folder.
   * @returns {Promise<boolean>} - true when the operation succeeds; otherwise, false.
   */
  async exportFolder(folderUuid: string): Promise<boolean> {
    this.exportingFolderUuid.set(folderUuid);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get(this.application.getApiUrl('v1', 'folders/' + folderUuid + '/export'), {
          observe: 'response',
          responseType: 'blob',
          withCredentials: true,
        }),
      );
      if (!response.body) throw new Error('The export archive was empty');
      const filename =
        this.archiveFilename(response.headers.get('Content-Disposition')) ?? 'documents.zip';
      const url = URL.createObjectURL(response.body);
      const link = this.document.createElement('a');
      link.href = url;
      link.download = filename;
      this.document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return false;
    } finally {
      this.exportingFolderUuid.set(null);
    }
  }

  /**
   * Clears the last folder operation error.
   *
   * @returns {void} - No value.
   */
  clearError(): void {
    this.error.set(null);
  }

  /**
   * Shares the link/unlink request flow and refreshes the affected tree branch.
   *
   * @param {string} folderUuid - UUID of the folder.
   * @param {string[]} documentUuids - Document UUIDs included in the operation.
   * @param {boolean} remove - Whether matching values should be removed.
   * @returns {Promise<FolderDocumentActionResponse | null>} - Shares the link/unlink request flow and refreshes the affected tree branch.
   */
  private async changeDocumentLinks(
    folderUuid: string,
    documentUuids: string[],
    remove: boolean,
  ): Promise<FolderDocumentActionResponse | null> {
    const input = FolderDocumentInputSchema.safeParse({ documentUuids });
    if (!input.success) return null;
    try {
      const response = remove
        ? await firstValueFrom(
            this.http.delete<ApiResponse<unknown>>(
              this.application.getApiUrl('v1', `folders/${folderUuid}/documents`),
              { body: input.data, withCredentials: true },
            ),
          )
        : await firstValueFrom(
            this.http.post<ApiResponse<unknown>>(
              this.application.getApiUrl('v1', `folders/${folderUuid}/documents`),
              input.data,
              { withCredentials: true },
            ),
          );
      const result = FolderDocumentActionResponseSchema.parse(response.data);
      await this.loadChildren(this.findFolder(folderUuid)?.parentUuid ?? null, true);
      return result;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    }
  }

  /**
   * Replaces a folder in its cached parent list after a server update.
   *
   * @param {FolderNode} updated - Updated record returned by persistence.
   * @returns {void} - No value.
   */
  private replaceFolder(updated: FolderNode): void {
    const key = this.parentKey(updated.parentUuid);
    this.children.update((current) => ({
      ...current,
      [key]: (current[key] ?? []).map((folder) =>
        folder.uuid === updated.uuid ? updated : folder,
      ),
    }));
  }

  /**
   * Removes a deleted or moved folder from all currently cached tree branches.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {void} - No value.
   */
  private removeFolderFromState(uuid: string): void {
    const next: Record<string, FolderNode[]> = {};
    for (const [key, folders] of Object.entries(this.children())) {
      next[key] = folders.filter((folder) => folder.uuid !== uuid);
    }
    this.children.set(next);
  }

  /**
   * Finds a folder in the loaded branches without triggering another request.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns {FolderNode | null} - Finds a folder in the loaded branches without triggering another request.
   */
  private findFolder(uuid: string): FolderNode | null {
    for (const folders of Object.values(this.children())) {
      const folder = folders.find((item) => item.uuid === uuid);
      if (folder) return folder;
    }
    return null;
  }

  /**
   * Maps the root parent to a stable cache key.
   *
   * @param {string | null} parentUuid - Parent folder UUID, or null for the root folder.
   * @returns {string} - Maps the root parent to a stable cache key.
   */
  private parentKey(parentUuid: string | null): string {
    return parentUuid ?? 'root';
  }

  /**
   * Adds or removes a parent key from the active child-loading set.
   *
   * @param {string} key - Setting, header, or metadata key to read or update.
   * @param {boolean} value - Value to store, parse, or compare.
   * @returns {void} - No value.
   */
  private setLoading(key: string, value: boolean): void {
    this.loadingParents.update((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /**
   * Returns a copied set with the given folder UUID removed.
   *
   * @param {Set<string>} values - Values to store, remove, or encode.
   * @param {string} value - Value to store, parse, or compare.
   * @returns {Set<string>} - A copied set with the given folder UUID removed.
   */
  private without(values: Set<string>, value: string): Set<string> {
    const next = new Set(values);
    next.delete(value);
    return next;
  }

  /**
   * Converts an HTTP failure into a message suitable for the folder UI.
   *
   * @param {unknown} error - Error value to handle or convert into a user-facing message.
   * @returns {string} - Converts an HTTP failure into a message suitable for the folder UI.
   */
  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 409)
      return 'A folder with this name already exists here.';
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string')
      return error.error.message;
    return 'The folder operation could not be completed. Please try again.';
  }

  /**
   * Extracts a safe archive filename from the response header when present.
   *
   * @param {string | null} contentDisposition - Content-Disposition header to parse for a filename.
   * @returns {string | null} - Extracts a safe archive filename from the response header when present.
   */
  private archiveFilename(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;

    const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) return decodeURIComponent(encoded);

    return (
      contentDisposition.match(/filename="([^"]+)"/i)?.[1] ??
      contentDisposition.match(/filename=([^;]+)/i)?.[1]?.trim() ??
      null
    );
  }
}

function sortFoldersByPath(folders: FolderNode[]): FolderNode[] {
  const byUuid = new Map(folders.map((folder) => [folder.uuid, folder]));
  const pathByUuid = new Map<string, string>();

  const pathFor = (folder: FolderNode): string => {
    const cached = pathByUuid.get(folder.uuid);
    if (cached) return cached;

    const parts: string[] = [];
    const visited = new Set<string>();
    let current: FolderNode | undefined = folder;
    while (current && !visited.has(current.uuid)) {
      visited.add(current.uuid);
      parts.unshift(current.name);
      current = current.parentUuid ? byUuid.get(current.parentUuid) : undefined;
    }

    const path = parts.join(' / ');
    pathByUuid.set(folder.uuid, path);
    return path;
  };

  return [...folders].sort((left, right) =>
    pathFor(left).localeCompare(pathFor(right), undefined, { numeric: true, sensitivity: 'base' }),
  );
}
