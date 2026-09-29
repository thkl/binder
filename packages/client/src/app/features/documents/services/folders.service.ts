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
  UpdateFolderInputSchema
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

export interface FolderTreeRow {
  folder: FolderNode;
  depth: number;
  expanded: boolean;
}

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

  constructor(private readonly http: HttpClient) {}

  async loadChildren(parentUuid: string | null, force = false): Promise<void> {
    const key = this.parentKey(parentUuid);
    if (!force && this.loadedParents().has(key)) return;
    if (this.loadingParents().has(key)) return;

    this.setLoading(key, true);
    this.error.set(null);
    try {
      const query = parentUuid ? `?parentUuid=${encodeURIComponent(parentUuid)}` : '';
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.application.getApiUrl('v1', `folders${query}`), { withCredentials: true })
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

  async toggle(folder: FolderNode): Promise<void> {
    if (this.expanded().has(folder.uuid)) {
      this.expanded.update((current) => this.without(current, folder.uuid));
      return;
    }
    await this.loadChildren(folder.uuid);
    this.expanded.update((current) => new Set(current).add(folder.uuid));
  }

  async listAll(): Promise<FolderNode[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.application.getApiUrl('v1', 'folders/all'), { withCredentials: true })
      );
      const folders = FolderDocumentListResponseSchema.parse(response.data).items;
      this.allFolders.set(folders);
      return folders;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return [];
    }
  }

  async listForDocument(documentUuid: string): Promise<FolderNode[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>(this.application.getApiUrl('v1', `folders/for-document/${documentUuid}`), { withCredentials: true })
      );
      return FolderDocumentListResponseSchema.parse(response.data).items;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return [];
    }
  }

  async setDocumentFolders(documentUuid: string, selectedUuids: string[], originalUuids: string[]): Promise<boolean> {
    const selected = new Set(selectedUuids);
    const original = new Set(originalUuids);
    const additions = [...selected].filter((uuid) => !original.has(uuid));
    const removals = [...original].filter((uuid) => !selected.has(uuid));
    const results = await Promise.all([
      ...additions.map((folderUuid) => this.linkDocuments(folderUuid, [documentUuid])),
      ...removals.map((folderUuid) => this.unlinkDocuments(folderUuid, [documentUuid]))
    ]);
    return results.every((result) => result !== null);
  }

  async create(name: string, parentUuid: string | null): Promise<FolderNode | null> {
    const input = CreateFolderInputSchema.safeParse({ name, parentUuid });
    if (!input.success) {
      this.error.set('Folder names must contain between 1 and 255 characters.');
      return null;
    }
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(this.application.getApiUrl('v1', 'folders'), input.data, { withCredentials: true })
      );
      const folder = FolderListResponseSchema.shape.items.element.parse(response.data);
      await this.loadChildren(parentUuid, true);
      return folder;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    }
  }

  async rename(uuid: string, name: string): Promise<boolean> {
    const input = UpdateFolderInputSchema.safeParse({ name });
    if (!input.success) {
      this.error.set('Folder names must contain between 1 and 255 characters.');
      return false;
    }
    try {
      const response = await firstValueFrom(
        this.http.patch<ApiResponse<unknown>>(this.application.getApiUrl('v1', `folders/${uuid}`), input.data, { withCredentials: true })
      );
      const updated = FolderListResponseSchema.shape.items.element.parse(response.data);
      this.replaceFolder(updated);
      return true;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return false;
    }
  }

  async move(uuid: string, parentUuid: string | null): Promise<boolean> {
    const input = MoveFolderInputSchema.safeParse({ parentUuid });
    if (!input.success) return false;
    const previousParentUuid = this.findFolder(uuid)?.parentUuid ?? null;
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(this.application.getApiUrl('v1', `folders/${uuid}/move`), input.data, { withCredentials: true })
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

  async remove(uuid: string): Promise<boolean> {
    const parentUuid = this.findFolder(uuid)?.parentUuid ?? null;
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(this.application.getApiUrl('v1', `folders/${uuid}`), { withCredentials: true })
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

  select(folderUuid: string | null): void {
    this.selectedFolderUuid.set(folderUuid);
  }

  async linkDocuments(folderUuid: string, documentUuids: string[]): Promise<FolderDocumentActionResponse | null> {
    return this.changeDocumentLinks(folderUuid, documentUuids, false);
  }

  async unlinkDocuments(folderUuid: string, documentUuids: string[]): Promise<FolderDocumentActionResponse | null> {
    return this.changeDocumentLinks(folderUuid, documentUuids, true);
  }

  async exportFolder(folderUuid: string): Promise<boolean> {
    this.exportingFolderUuid.set(folderUuid);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get(
          this.application.getApiUrl('v1', 'folders/' + folderUuid + '/export'),
          { observe: 'response', responseType: 'blob', withCredentials: true }
        )
      );
      if (!response.body) throw new Error('The export archive was empty');
      const filename = this.archiveFilename(response.headers.get('Content-Disposition')) ?? 'documents.zip';
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

  clearError(): void {
    this.error.set(null);
  }

  private async changeDocumentLinks(folderUuid: string, documentUuids: string[], remove: boolean): Promise<FolderDocumentActionResponse | null> {
    const input = FolderDocumentInputSchema.safeParse({ documentUuids });
    if (!input.success) return null;
    try {
      const response = remove
        ? await firstValueFrom(this.http.delete<ApiResponse<unknown>>(this.application.getApiUrl('v1', `folders/${folderUuid}/documents`), { body: input.data, withCredentials: true }))
        : await firstValueFrom(this.http.post<ApiResponse<unknown>>(this.application.getApiUrl('v1', `folders/${folderUuid}/documents`), input.data, { withCredentials: true }));
      const result = FolderDocumentActionResponseSchema.parse(response.data);
      await this.loadChildren(this.findFolder(folderUuid)?.parentUuid ?? null, true);
      return result;
    } catch (error) {
      this.error.set(this.errorMessage(error));
      return null;
    }
  }

  private replaceFolder(updated: FolderNode): void {
    const key = this.parentKey(updated.parentUuid);
    this.children.update((current) => ({
      ...current,
      [key]: (current[key] ?? []).map((folder) => folder.uuid === updated.uuid ? updated : folder)
    }));
  }

  private removeFolderFromState(uuid: string): void {
    const next: Record<string, FolderNode[]> = {};
    for (const [key, folders] of Object.entries(this.children())) {
      next[key] = folders.filter((folder) => folder.uuid !== uuid);
    }
    this.children.set(next);
  }

  private findFolder(uuid: string): FolderNode | null {
    for (const folders of Object.values(this.children())) {
      const folder = folders.find((item) => item.uuid === uuid);
      if (folder) return folder;
    }
    return null;
  }

  private parentKey(parentUuid: string | null): string {
    return parentUuid ?? 'root';
  }

  private setLoading(key: string, value: boolean): void {
    this.loadingParents.update((current) => {
      const next = new Set(current);
      if (value) next.add(key); else next.delete(key);
      return next;
    });
  }

  private without(values: Set<string>, value: string): Set<string> {
    const next = new Set(values);
    next.delete(value);
    return next;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 409) return 'A folder with this name already exists here.';
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') return error.error.message;
    return 'The folder operation could not be completed. Please try again.';
  }

  private archiveFilename(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;

    const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) return decodeURIComponent(encoded);

    return contentDisposition.match(/filename="([^"]+)"/i)?.[1]
      ?? contentDisposition.match(/filename=([^;]+)/i)?.[1]?.trim()
      ?? null;
  }
}
