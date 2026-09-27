import { ChangeDetectionStrategy, Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { DocumentMetadataEditorComponent } from '../../../metadata/components/document-metadata-editor/document-metadata-editor.component';
import { DocumentViewerComponent } from '../../../../common/components/document-viewer/document-viewer.component';
import { DocumentActionsComponent } from '../document-actions/document-actions.component';
import type {
  Document,
  DocumentBulkAction,
  DocumentBulkActionResponse,
  DocumentGroupBy,
  DocumentTitleSuggestion
} from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';

type DocumentViewMode = 'list' | 'icons';
type DocumentGroupMode = DocumentGroupBy;
type DocumentSortDirection = 'asc' | 'desc';
type DocumentGroup = { key: string; label: string | null; documents: Document[] };

@Component({
  selector: 'binder-documents',
  standalone: true,
  imports: [CommonModule, DocumentMetadataEditorComponent, DocumentViewerComponent, DocumentActionsComponent, TranslatePipe],
  templateUrl: './documents.component.html',
  styleUrl: './documents.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentsComponent implements OnInit {
  readonly documents = inject(DocumentsService);
  private readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  readonly thumbnailFailed = signal<Record<string, boolean>>({});
  readonly viewMode = signal<DocumentViewMode>(this.readViewMode());
  readonly groupMode = signal<DocumentGroupMode>(this.readGroupMode());
  readonly sortDirection  = signal<DocumentSortDirection>(this.readSortDirection());
  readonly metadataDocumentUuid = signal<string | null>(null);
  readonly titleSuggestions = signal<Record<string, DocumentTitleSuggestion>>({});
  readonly titleSuggestionLoading = signal<Record<string, boolean>>({});
  readonly editingTitleUuid = signal<string | null>(null);
  readonly viewerDocumentUuid = signal<string | null>(null);
  readonly metadataDirty = signal(false);
  readonly metadataClosePrompt = signal(false);
  readonly selectedDocumentUuids = signal<Set<string>>(new Set());
  readonly bulkActionInProgress = signal<DocumentBulkAction | null>(null);
  readonly bulkActionResult = signal<DocumentBulkActionResponse | null>(null);
  
  readonly metadataDocument = computed(() => {
    const uuid = this.metadataDocumentUuid();
    return this.documents.page()?.items.find((document) => document.uuid === uuid) ?? null;
  });
  
  readonly documentData = this.metadataDocument;

  readonly selectedCount = computed(() => this.selectedDocumentUuids().size);
  readonly allVisibleSelected = computed(() => {
    const visible = this.documents.page()?.items ?? [];
    return visible.length > 0 && visible.every((document) => this.selectedDocumentUuids().has(document.uuid));
  });

  readonly viewerDocument = computed(() => {
    const uuid = this.viewerDocumentUuid();
    return this.documents.page()?.items.find((document) => document.uuid === uuid) ?? null;
  });
  
  readonly documentGroups = computed<DocumentGroup[]>(() => {
    const documents = this.documents.page()?.items ?? [];
    const mode = this.groupMode();
    if (mode === 'none') return [{ key: 'all', label: null, documents }];
    const groups = new Map<string, DocumentGroup>();
    for (const document of documents) {
      const values = this.groupValues(document, mode);
      const groupValues = values.length > 0 ? values : [{ key: '__none', label: null }];
      for (const value of groupValues) {
        const group = groups.get(value.key) ?? { key: value.key, label: value.label, documents: [] };
        group.documents.push(document);
        groups.set(value.key, group);
      }
    }
    return [...groups.values()].sort((left, right) => (left.label ?? '').localeCompare(right.label ?? ''));
  });

  ngOnInit(): void {
    void this.documents.load({ groupBy: this.groupMode() });
  }

  async fileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (file.type !== 'application/pdf') {
      this.documents.error.set('Only PDF documents are supported.');
      return;
    }
    await this.documents.upload(file);
  }

  async nextPage(): Promise<void> {
    const page = this.documents.page();
    if (page?.hasNext) {
      this.clearSelection();
      await this.documents.load({ page: page.page + 1, pageSize: page.pageSize });
    }
  }

  async previousPage(): Promise<void> {
    const page = this.documents.page();
    if (page && page.hasPrev) {
      this.clearSelection();
      await this.documents.load({ page: page.page - 1, pageSize: page.pageSize });
    }
  }

  toggleDocumentSelection(uuid: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedDocumentUuids.update((selected) => {
      const next = new Set(selected);
      if (checked) {
        next.add(uuid);
      } else {
        next.delete(uuid);
      }
      return next;
    });
    this.bulkActionResult.set(null);
  }

  toggleAllVisible(): void {
    const visible = this.documents.page()?.items ?? [];
    const allSelected = this.allVisibleSelected();
    this.selectedDocumentUuids.update((selected) => {
      const next = new Set(selected);
      for (const document of visible) {
        if (allSelected) {
          next.delete(document.uuid);
        } else {
          next.add(document.uuid);
        }
      }
      return next;
    });
    this.bulkActionResult.set(null);
  }

  isDocumentSelected(uuid: string): boolean {
    return this.selectedDocumentUuids().has(uuid);
  }

  clearSelection(): void {
    this.selectedDocumentUuids.set(new Set());
    this.bulkActionResult.set(null);
  }

  async runBulkAction(action: DocumentBulkAction): Promise<void> {
    if (this.selectedCount() === 0 || !this.canLeaveMetadata()) return;

    this.bulkActionInProgress.set(action);
    this.bulkActionResult.set(null);
    const result = await this.documents.bulkAction({
      documentUuids: [...this.selectedDocumentUuids()],
      action
    });
    this.bulkActionInProgress.set(null);
    if (result) {
      this.selectedDocumentUuids.set(new Set());
      this.bulkActionResult.set(result);
    }
  }

  thumbnailUrl(uuid: string): string | null {
    return this.documents.page()?.items.find((document) => document.uuid === uuid)?.thumbnailUrl ?? null;
  }

  documentFormat(document: Document): string {
    if (document.mimeType === 'application/pdf') return 'PDF';
    const parts = document.mimeType.split('/');
    return (parts[1] || parts[0] || 'FILE').toUpperCase();
  }

  hasThumbnailFailed(uuid: string): boolean {
    return this.thumbnailFailed()[uuid] === true;
  }

  markThumbnailFailed(uuid: string): void {
    this.thumbnailFailed.update((current) => ({ ...current, [uuid]: true }));
  }

  setViewMode(mode: DocumentViewMode): void {
    this.viewMode.set(mode);
    localStorage.setItem('binder.documents.view-mode', mode);
  }

  setGroupMode(mode: DocumentGroupMode): void {
    if (!this.canLeaveMetadata()) {
      console.log("canLeaveMetadata is false")
      return;
    }
    console.log("Set Group Mode ",mode)
    this.groupMode.set(mode);
    localStorage.setItem('binder.documents.group-mode', mode);
    this.clearSelection();
    void this.documents.load({ page: 1, groupBy: mode });
  }


  setSortDirection(direction: DocumentSortDirection): void {
    if (!this.canLeaveMetadata()) {
      console.log("canLeaveMetadata is false")
      return;
    }
    console.log("Set SortDirection",direction)
    this.sortDirection.set(direction);
    localStorage.setItem('binder.documents.sortDirection', direction);
    this.clearSelection();
    void this.documents.load({ page: 1, direction: direction });
  }

  markDocumentReviewed(uuid: string): void {
    this.documents.page.update((page) => page ? {
      ...page,
      items: page.items.map((document) => document.uuid === uuid ? { ...document, isNew: false } : document)
    } : page);
  }


  async requeueDocument(uuid:string) {
    await this.documents.requeueDocument(uuid);
  }

  toggleMetadata(uuid: string): void {
    const current = this.metadataDocumentUuid();
    if (current === uuid) {
      this.requestCloseMetadata();
      return;
    }
    if (!this.canLeaveMetadata()) return;

    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.viewerDocumentUuid.set(null);
    this.metadataDocumentUuid.set(uuid);
  }

  requestCloseMetadata(): void {
    if (!this.metadataDocumentUuid()) return;
    if (this.metadataDirty()) {
      this.metadataClosePrompt.set(true);
      return;
    }
    this.finishCloseMetadata();
  }

  metadataDirtyChanged(dirty: boolean): void {
    this.metadataDirty.set(dirty);
    if (!dirty) this.metadataClosePrompt.set(false);
  }

  discardMetadataChanges(): void {
    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.finishCloseMetadata();
  }

  private finishCloseMetadata(): void {
    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.metadataDocumentUuid.set(null);
  }

  openDocument(uuid: string): void {
    if (!this.canLeaveMetadata()) return;
    this.metadataDocumentUuid.set(null);
    this.viewerDocumentUuid.set(uuid);
  }

  closeDocumentViewer(): void {
    this.viewerDocumentUuid.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.requestCloseMetadata();
    this.closeDocumentViewer();
  }

  private canLeaveMetadata(): boolean {
    if (!this.metadataDocumentUuid() || !this.metadataDirty()) return true;
    this.metadataClosePrompt.set(true);
    return false;
  }

  async renameDocument(uuid: string, event: Event): Promise<void> {
    const title = (event.target as HTMLInputElement).value.trim();
    if (title) await this.documents.updateTitle(uuid, title);
  }

  startInlineTitleEdit(uuid: string, event: Event): void {
    event.stopPropagation();
    this.editingTitleUuid.set(uuid);

    queueMicrotask(() => {
      const input = this.document.querySelector<HTMLInputElement>(`[data-title-editor="${uuid}"]`);
      input?.focus();
      input?.select();
    });
  }

  async finishInlineTitleEdit(uuid: string, event: Event): Promise<void> {
    if (this.editingTitleUuid() !== uuid) return;
    await this.renameDocument(uuid, event);
    if (this.editingTitleUuid() === uuid) this.editingTitleUuid.set(null);
  }

  handleInlineTitleKeydown(uuid: string, event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.editingTitleUuid.set(null);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      (event.target as HTMLInputElement).blur();
    }
  }

  async suggestTitle(uuid: string): Promise<void> {
    this.titleSuggestionLoading.update((current) => ({ ...current, [uuid]: true }));
    const suggestion = await this.documents.suggestTitle(uuid);
    this.titleSuggestionLoading.update((current) => ({ ...current, [uuid]: false }));
    if (suggestion) {
      this.titleSuggestions.update((current) => ({ ...current, [uuid]: suggestion }));
      if (this.metadataDocumentUuid() !== uuid && !this.canLeaveMetadata()) return;
      this.viewerDocumentUuid.set(null);
      this.metadataDocumentUuid.set(uuid);
    }
  }

  async acceptTitleSuggestion(uuid: string): Promise<void> {
    const suggestion = this.titleSuggestions()[uuid];
    if (!suggestion || !(await this.documents.updateTitle(uuid, suggestion.suggestedTitle))) return;
    this.titleSuggestions.update((current) => { const next = { ...current }; delete next[uuid]; return next; });
  }

  async dismissTitleSuggestion(uuid: string): Promise<void> {
    if (await this.documents.clearSuggestion(uuid) === null) return;
    this.titleSuggestions.update((current) => { const next = { ...current }; delete next[uuid]; return next; });
  }

  async acceptSuggestedMetadata(uuid: string, title: string): Promise<void> {
    if (!(await this.documents.updateTitle(uuid, title))) return;
    if (await this.documents.clearSuggestion(uuid) === null) return;
    this.titleSuggestions.update((current) => { const next = { ...current }; delete next[uuid]; return next; });
  }

  async acceptSuggestedTitleValue(uuid: string, title: string): Promise<void> {
    await this.documents.updateTitle(uuid, title);
  }

  dismissLocalTitleSuggestion(uuid: string): void {
    this.titleSuggestions.update((current) => { const next = { ...current }; delete next[uuid]; return next; });
  }

  private readSortDirection(): DocumentSortDirection {
    const stored = localStorage.getItem('binder.documents.sortDirection');
    return stored === 'asc' || stored === 'desc'
      ? stored
      : 'desc';
  }

  private readGroupMode(): DocumentGroupMode {
    const stored = localStorage.getItem('binder.documents.group-mode');
    return stored === 'documentType' || stored === 'category' || stored === 'issuer' || stored === 'tag' || stored === 'status' || stored === 'isNew'
      ? stored
      : 'none';
  }
  
  
  private readViewMode(): DocumentViewMode {
    const stored = localStorage.getItem('binder.documents.view-mode');
    return stored === 'small-icons' || stored === 'large-icons' || stored === 'icons'
      ? 'icons'
      : 'list';
  }

  private groupValues(document: Document, mode: DocumentGroupMode): Array<{ key: string; label: string | null }> {
    switch (mode) {
      case 'documentType':
        return document.metadataSummary.documentType
          ? [{ key: document.metadataSummary.documentType.uuid, label: document.metadataSummary.documentType.name }]
          : [];
      case 'category':
        return document.metadataSummary.category
          ? [{ key: document.metadataSummary.category.uuid, label: document.metadataSummary.category.name }]
          : [];
      case 'issuer':
        return document.metadataSummary.issuer
          ? [{ key: document.metadataSummary.issuer.uuid, label: document.metadataSummary.issuer.name }]
          : [];
      case 'tag':
        return document.metadataSummary.tags.map((tag) => ({ key: tag.uuid, label: tag.name }));
      case 'status':
        return [{ key: document.status, label: this.i18n.t('documents.status.' + document.status) }];
      case 'isNew':
        return [{
          key: document.isNew ? 'new' : 'reviewed',
          label: this.i18n.t(document.isNew ? 'documents.new' : 'documents.reviewed')
        }];
      case 'none':
        return [];
    }
  }
}
