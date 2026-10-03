import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SearchService } from '../../services/search.service';
import { DocumentsService } from '../../../documents/services/documents.service';
import {
  DocumentDrawerComponent,
  DocumentDrawerMode,
  DocumentDrawerTab,
} from '../../../documents/components/document-drawer/document-drawer.component';
import { SavedSearchMenuComponent } from '../../../documents/components/saved-search-menu/saved-search-menu.component';
import { SavedSearchService } from '../../../documents/services/saved-search.service';
import type { Document } from '@binder/common';
import { DocumentSearchQuerySchema } from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { RouterLink } from '@angular/router';
import { ConfirmDialogComponent } from '../../../../common/components/confirm-dialog/confirm-dialog.component';
import { InboxService } from '../../../inbox/services/inbox.service';

@Component({
  selector: 'binder-home',
  standalone: true,
  imports: [
    CommonModule,
    DocumentDrawerComponent,
    SavedSearchMenuComponent,
    RouterLink,
    ConfirmDialogComponent,
    TranslatePipe,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  readonly search = inject(SearchService);
  readonly documents = inject(DocumentsService);
  readonly savedSearches = inject(SavedSearchService);
  readonly i18n = inject(I18nService);
  readonly inbox = inject(InboxService);
  readonly searchQuery = signal('');
  readonly drawerDocumentUuid = signal<string | null>(null);
  readonly drawerTab = signal<DocumentDrawerTab>('preview');
  readonly drawerMode = signal<DocumentDrawerMode>('analysis');
  readonly drawerDocumentSnapshot = signal<Document | null>(null);
  readonly metadataDirty = signal(false);
  readonly metadataClosePrompt = signal(false);
  readonly deleteDialogUuid = signal<string | null>(null);
  readonly duplicateDocumentLoading = signal(false);
  readonly selectedType = signal('');
  readonly selectedCategory = signal('');
  readonly selectedTag = signal('');
  readonly selectedIssuer = signal('');
  readonly onlySemantic = signal(true);
  readonly semanticThreshold = signal(0.35);
  readonly searchOptionsOpen = signal(false);
  readonly selectedSavedSearchUuid = signal<string | null>(null);
  readonly uploadDragActive = signal(false);
  readonly uploadMessage = signal<'success' | null>(null);
  readonly uploadError = signal<string | null>(null);
  readonly uploadingFiles = signal(false);
  readonly uploadQueueTotal = signal(0);
  readonly uploadQueueCompleted = signal(0);
  readonly uploadedCount = signal(0);
  private lastDocumentChangeRevision = 0;

  private readonly documentChangeEffect = effect(() => {
    const revision = this.inbox.documentChangeRevision();
    if (revision === 0 || revision === this.lastDocumentChangeRevision) return;

    this.lastDocumentChangeRevision = revision;
    if (this.search.result()) {
      void this.reloadSearch();
    }
  });

  readonly activeSearchOptionCount = computed(() => {
    let count = 0;
    if (this.selectedType()) count += 1;
    if (this.selectedCategory()) count += 1;
    if (this.selectedTag()) count += 1;
    if (this.selectedIssuer()) count += 1;
    if (!this.onlySemantic()) count += 1;
    if (this.semanticThreshold() !== 0.35) count += 1;
    return count;
  });

  constructor() {
    void this.savedSearches.load();
  }

  readonly drawerDocument = computed(() => {
    const uuid = this.drawerDocumentUuid();
    const current = this.search
      .result()
      ?.items.find((item) => item.document.uuid === uuid)?.document;
    return current ?? this.drawerDocumentSnapshot();
  });

  readonly uploadInProgress = computed(() => this.uploadingFiles() || this.documents.uploading());

  searchResult = computed(() => {
    const result = this.search.result();
    if (result) {
      const sorted = (
        this.onlySemantic()
          ? result.items.filter((item) => item.semanticScore !== null)
          : result.items
      ).sort((i1, i2) => {
        if (i1.semanticScore === null && i2.semanticScore === null) {
          return 0;
        }
        if (i1.semanticScore ?? 0 > (i2.semanticScore ?? 0)) return 1;
        if (i2.semanticScore ?? 0 > (i1.semanticScore ?? 0)) return -1;
        return 0;
      });
      return sorted;
    } else {
      return [];
    }
  });

  itemName(item: { name: string; translations: Record<string, string> }): string {
    return this.i18n.name(item);
  }

  formatCustomMetadata(value: unknown): string {
    if (Array.isArray(value))
      return value.map((item) => this.formatCustomMetadata(item)).join(', ');
    if (value !== null && typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  async submitSearch(event: Event): Promise<void> {
    event.preventDefault();
    this.selectedSavedSearchUuid.set(null);
    await this.runSearch();
  }

  async applySearchOptions(): Promise<void> {
    this.selectedSavedSearchUuid.set(null);
    await this.runSearch();
  }

  async clearSearchOptions(): Promise<void> {
    this.selectedType.set('');
    this.selectedCategory.set('');
    this.selectedTag.set('');
    this.selectedIssuer.set('');
    this.onlySemantic.set(true);
    this.semanticThreshold.set(0.35);
    this.selectedSavedSearchUuid.set(null);
    if (this.searchQuery().trim()) {
      await this.runSearch();
    }
  }

  onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
    this.selectedSavedSearchUuid.set(null);
  }

  onUploadDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.uploadInProgress()) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.uploadDragActive.set(true);
  }

  onUploadDragLeave(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement;
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && target.contains(relatedTarget)) return;
    this.uploadDragActive.set(false);
  }

  async onUploadDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.uploadDragActive.set(false);
    if (this.uploadInProgress()) return;
    await this.uploadFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  async onUploadSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    await this.uploadFiles(files);
  }

  private async uploadFiles(files: File[]): Promise<void> {
    this.uploadMessage.set(null);
    this.uploadError.set(null);
    this.documents.clearUploadNotice();
    this.uploadedCount.set(0);
    this.uploadQueueCompleted.set(0);
    this.uploadQueueTotal.set(files.length);

    if (files.length === 0) return;

    const pdfFiles = files.filter((file) => this.isPdf(file));
    const invalidFileCount = files.length - pdfFiles.length;
    this.uploadQueueTotal.set(pdfFiles.length);

    if (invalidFileCount > 0) {
      this.uploadError.set(this.i18n.t('home.uploadOnlyPdf'));
    }

    if (pdfFiles.length === 0) return;

    this.uploadingFiles.set(true);
    let failedCount = 0;

    try {
      for (const file of pdfFiles) {
        const uploaded = await this.documents.upload(file);

        if (uploaded) {
          this.uploadedCount.update((count) => count + 1);
        } else {
          failedCount += 1;
        }

        this.uploadQueueCompleted.update((count) => count + 1);
      }
    } finally {
      this.uploadingFiles.set(false);
    }

    if (this.uploadedCount() > 0) {
      this.uploadMessage.set('success');
    }

    if (failedCount > 0 && !this.uploadError() && !this.documents.duplicateUpload()) {
      this.uploadError.set(this.documents.error() ?? this.i18n.t('home.uploadFailed'));
    }
  }

  private isPdf(file: File): boolean {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  }

  async saveCurrentSearch(name: string): Promise<void> {
    const parsed = DocumentSearchQuerySchema.safeParse({
      q: this.searchQuery(),
      limit: 20,
      semanticThreshold: this.semanticThreshold(),
      documentTypeUuid: this.selectedType() || undefined,
      categoryUuid: this.selectedCategory() || undefined,
      issuerUuid: this.selectedIssuer() || undefined,
      tagUuids: this.selectedTag() ? [this.selectedTag()] : undefined,
    });
    if (!parsed.success) return;

    const saved = await this.savedSearches.create({
      name,
      definition: {
        kind: 'semantic',
        query: parsed.data,
        onlySemantic: this.onlySemantic(),
      },
    });
    if (saved) this.selectedSavedSearchUuid.set(saved.uuid);
  }

  async loadSavedSearch(uuid: string): Promise<void> {
    if (!uuid) {
      this.selectedSavedSearchUuid.set(null);
      return;
    }

    const saved = this.savedSearches.items().find((item) => item.uuid === uuid);
    if (!saved || saved.definition.kind !== 'semantic') return;

    const query = saved.definition.query;
    this.selectedSavedSearchUuid.set(saved.uuid);
    this.searchQuery.set(query.q);
    this.selectedType.set(query.documentTypeUuid ?? '');
    this.selectedCategory.set(query.categoryUuid ?? '');
    this.selectedIssuer.set(query.issuerUuid ?? '');
    this.selectedTag.set(query.tagUuids?.[0] ?? '');
    this.semanticThreshold.set(query.semanticThreshold);
    this.onlySemantic.set(saved.definition.onlySemantic);
    await this.runSearch();
  }

  async removeSavedSearch(uuid: string): Promise<void> {
    if (!window.confirm(this.i18n.t('documents.savedSearchDeleteConfirm'))) return;
    if ((await this.savedSearches.remove(uuid)) && this.selectedSavedSearchUuid() === uuid) {
      this.selectedSavedSearchUuid.set(null);
    }
  }

  async renameSavedSearch(input: { uuid: string; name: string }): Promise<void> {
    await this.savedSearches.update(input.uuid, { name: input.name });
  }

  private async runSearch(): Promise<void> {
    await this.search.search(this.searchQuery(), {
      documentTypeUuid: this.selectedType() || undefined,
      categoryUuid: this.selectedCategory() || undefined,
      issuerUuid: this.selectedIssuer() || undefined,
      tagUuids: this.selectedTag() ? [this.selectedTag()] : undefined,
      semanticThreshold: this.semanticThreshold(),
    });
  }

  openDocument(event: Event, uuid: string): void {
    event.preventDefault();
    if (!this.canLeaveMetadata()) return;
    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.drawerTab.set('preview');
    this.drawerMode.set('analysis');
    this.drawerDocumentSnapshot.set(this.findDocument(uuid));
    this.drawerDocumentUuid.set(uuid);
  }

  openMetadata(event: Event, uuid: string): void {
    event.preventDefault();
    if (!this.canLeaveMetadata()) return;
    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.drawerTab.set('metadata');
    this.drawerMode.set('analysis');
    this.drawerDocumentSnapshot.set(this.findDocument(uuid));
    this.drawerDocumentUuid.set(uuid);
  }

  requestCloseDrawer(): void {
    if (!this.drawerDocumentUuid()) return;
    if (this.metadataDirty()) {
      this.metadataClosePrompt.set(true);
      return;
    }
    this.closeDrawer();
  }

  metadataDirtyChanged(dirty: boolean): void {
    this.metadataDirty.set(dirty);
    if (!dirty) this.metadataClosePrompt.set(false);
  }

  discardMetadataChanges(): void {
    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.closeDrawer();
  }

  async metadataSaved(): Promise<void> {
    this.metadataDirty.set(false);
    await this.reloadSearch();
  }

  async titleSuggestionAccepted(): Promise<void> {
    await this.reloadSearch();
  }

  async generateArchive(uuid: string): Promise<void> {
    await this.documents.generateArchive(uuid);
    await this.reloadSearch();
  }

  requestDeleteDocument(uuid: string): void {
    if (!this.canLeaveMetadata()) return;
    this.deleteDialogUuid.set(uuid);
  }

  async openDuplicateDocument(): Promise<void> {
    const uuid = this.documents.duplicateUploadUuid();
    if (!uuid || this.duplicateDocumentLoading()) return;
    if (!this.canLeaveMetadata()) return;

    this.duplicateDocumentLoading.set(true);
    try {
      const document = await this.documents.loadDocument(uuid);
      if (!document) return;

      this.metadataClosePrompt.set(false);
      this.metadataDirty.set(false);
      this.drawerTab.set('preview');
      this.drawerMode.set('analysis');
      this.drawerDocumentSnapshot.set(document);
      this.drawerDocumentUuid.set(document.uuid);
    } finally {
      this.duplicateDocumentLoading.set(false);
    }
  }

  cancelDeleteDocument(): void {
    this.deleteDialogUuid.set(null);
  }

  async confirmDeleteDocument(): Promise<void> {
    const uuid = this.deleteDialogUuid();
    this.deleteDialogUuid.set(null);
    if (!uuid) return;

    const deleted = await this.documents.remove(uuid);
    if (deleted && this.drawerDocumentUuid() === uuid) {
      this.closeDrawer();
      await this.reloadSearch();
    }
  }

  documentLabel(uuid: string): string {
    const document = this.findDocument(uuid);
    return document?.title || document?.originalFilename || uuid;
  }

  private closeDrawer(): void {
    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.drawerDocumentUuid.set(null);
    this.drawerDocumentSnapshot.set(null);
  }

  private canLeaveMetadata(): boolean {
    if (!this.drawerDocumentUuid() || !this.metadataDirty()) return true;
    this.metadataClosePrompt.set(true);
    return false;
  }

  async reloadSearch(): Promise<void> {
    await this.runSearch();
  }

  private findDocument(uuid: string): Document | null {
    return (
      this.search.result()?.items.find((item) => item.document.uuid === uuid)?.document ?? null
    );
  }
}
