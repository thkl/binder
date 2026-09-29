import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { FoldersService } from '../../services/folders.service';
import { DocumentDrawerComponent, DocumentDrawerTab } from '../document-drawer/document-drawer.component';
import { DocumentActionsComponent } from '../document-actions/document-actions.component';
import { DocumentFilterMenuComponent } from '../document-filter-menu/document-filter-menu.component';
import { FolderTreeComponent } from '../folder-tree/folder-tree.component';
import type {
  Document,
  DocumentBulkAction,
  DocumentBulkActionResponse,
  DocumentListFacetOption,
  DocumentListQuery,
  DocumentGroupBy,
  DocumentStatus,
  DocumentTitleSuggestion
} from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';

type DocumentViewMode = 'list' | 'icons';
type DocumentGroupMode = DocumentGroupBy;
type DocumentSortDirection = 'asc' | 'desc';
type DocumentGroup = { key: string; label: string | null; documents: Document[] };
type DocumentFilterKey = 'documentType' | 'category' | 'issuer' | 'tag' | 'status' | 'reviewState';
type DocumentFilterValues = {
  documentType: string[] | undefined;
  category: string[] | undefined;
  issuer: string[] | undefined;
  tag: string[] | undefined;
  status: DocumentStatus[] | undefined;
  reviewState: Array<'new' | 'reviewed'> | undefined;
};

@Component({
  selector: 'binder-documents',
  standalone: true,
  imports: [
    CommonModule,
    DocumentDrawerComponent,
    DocumentActionsComponent,
    DocumentFilterMenuComponent,
    FolderTreeComponent,
    TranslatePipe
  ],
  templateUrl: './documents.component.html',
  styleUrl: './documents.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentsComponent implements OnInit, OnDestroy {
  readonly documents = inject(DocumentsService);
  readonly folders = inject(FoldersService);
  private readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  readonly thumbnailFailed = signal<Record<string, boolean>>({});
  readonly viewMode = signal<DocumentViewMode>(this.readViewMode());
  readonly groupMode = signal<DocumentGroupMode>(this.readGroupMode());
  readonly sortDirection  = signal<DocumentSortDirection>(this.readSortDirection());
  readonly groupDirection = signal<DocumentSortDirection>(this.readGroupDirection());
  readonly drawerDocumentUuid = signal<string | null>(null);
  readonly drawerTab = signal<DocumentDrawerTab>('preview');
  readonly drawerDocumentSnapshot = signal<Document | null>(null);
  readonly titleSuggestions = signal<Record<string, DocumentTitleSuggestion>>({});
  readonly titleSuggestionLoading = signal<Record<string, boolean>>({});
  readonly editingTitleUuid = signal<string | null>(null);
  readonly metadataDirty = signal(false);
  readonly metadataClosePrompt = signal(false);
  readonly selectedDocumentUuids = signal<Set<string>>(new Set());
  readonly bulkActionInProgress = signal<DocumentBulkAction | null>(null);
  readonly bulkActionResult = signal<DocumentBulkActionResponse | null>(null);
  readonly folderActionInProgress = signal<'add' | 'remove' | null>(null);
  readonly folderActionMessage = signal<string | null>(null);
  readonly listSearch = signal('');
  readonly activeFilterMenu = signal<DocumentFilterKey | null>(null);
  readonly filterValues = signal<DocumentFilterValues>({
    documentType: undefined,
    category: undefined,
    issuer: undefined,
    tag: undefined,
    status: undefined,
    reviewState: undefined
  });

  private readonly folderPages = signal<Record<string, number>>({});
  private readonly allDocumentsFolderKey = '__all-documents__';
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  
  readonly drawerDocument = computed(() => {
    const uuid = this.drawerDocumentUuid();
    const current = this.documents.page()?.items.find((document) => document.uuid === uuid);
    return current ?? this.drawerDocumentSnapshot();
  });

  readonly selectedCount = computed(() => this.selectedDocumentUuids().size);
  readonly activeFilterCount = computed(() => {
    const values = this.filterValues();
    const selectedFilters = Object.values(values).filter((selection) => selection !== undefined).length;
    return selectedFilters + (this.listSearch().trim() ? 1 : 0);
  });
  readonly hasActiveFilters = computed(() => this.activeFilterCount() > 0);
  readonly exportScope = computed<'selected' | 'filtered' | 'folder' | null>(() => {
    if (this.selectedCount() > 0) return 'selected';
    if (this.hasActiveFilters()) return 'filtered';
    return this.folders.selectedFolderUuid() ? 'folder' : null;
  });
  readonly exportInProgress = computed(() => (
    this.documents.exporting() || this.folders.exportingFolderUuid() !== null
  ));
  readonly allVisibleSelected = computed(() => {
    const visible = this.documents.page()?.items ?? [];
    return visible.length > 0 && visible.every((document) => this.selectedDocumentUuids().has(document.uuid));
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
    return this.sortGroups([...groups.values()]);
  });

  ngOnInit(): void {
    void this.folders.loadChildren(null);
    void this.documents.load({ groupBy: this.groupMode() });
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  async selectFolder(folderUuid: string | null): Promise<void> {
    if (!this.canLeaveMetadata()) return;

    this.activeFilterMenu.set(null);
    this.rememberCurrentFolderPage();
    this.folders.select(folderUuid);
    await this.loadFolderPage(folderUuid);
  }

  async exportCurrentScope(): Promise<void> {
    const scope = this.exportScope();

    if (scope === 'selected') {
      await this.documents.exportSelected([...this.selectedDocumentUuids()]);
      return;
    }

    if (scope === 'filtered') {
      await this.documents.exportFiltered(this.buildFilterQuery());
      return;
    }

    const folderUuid = this.folders.selectedFolderUuid();
    if (folderUuid) {
      await this.folders.exportFolder(folderUuid);
    }
  }

  onListSearch(event: Event): void {
    if (!this.canLeaveMetadata()) return;

    const value = (event.target as HTMLInputElement).value;
    this.listSearch.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);

    this.searchTimer = setTimeout(() => {
      this.applyListQuery(this.buildFilterQuery());
    }, 300);
  }

  toggleFilterMenu(key: DocumentFilterKey): void {
    this.activeFilterMenu.update((current) => current === key ? null : key);
  }

  closeFilterMenu(): void {
    this.activeFilterMenu.set(null);
  }

  applyFilter(key: DocumentFilterKey, values: string[] | undefined): void {
    if (!this.canLeaveMetadata()) return;

    this.filterValues.update((current) => ({ ...current, [key]: values }));
    this.applyListQuery(this.buildFilterQuery());
  }

  clearAllFilters(): void {
    if (!this.canLeaveMetadata()) return;

    this.listSearch.set('');
    this.filterValues.set({
      documentType: undefined,
      category: undefined,
      issuer: undefined,
      tag: undefined,
      status: undefined,
      reviewState: undefined
    });
    this.applyListQuery(this.buildFilterQuery());
  }

  facetOptions(key: DocumentFilterKey): DocumentListFacetOption[] {
    const options = this.documents.facets()?.[key] ?? [];
    return options
      .map((option) => ({
        ...option,
        label: this.facetLabel(key, option)
      }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true }));
  }

  async changeFolderMembership(action: 'add' | 'remove'): Promise<void> {
    const folderUuid = this.folders.selectedFolderUuid();
    if (!folderUuid || this.selectedCount() === 0 || this.folderActionInProgress()) return;
    this.folderActionInProgress.set(action);
    this.folderActionMessage.set(null);
    const result = action === 'add'
      ? await this.folders.linkDocuments(folderUuid, [...this.selectedDocumentUuids()])
      : await this.folders.unlinkDocuments(folderUuid, [...this.selectedDocumentUuids()]);
    this.folderActionInProgress.set(null);
    if (result) {
      this.folderActionMessage.set(`${result.affected} ${action === 'add' ? 'document(s) added to' : 'document(s) removed from'} folder.`);
      this.clearSelection();
      await this.documents.load();
    }
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
      this.rememberCurrentFolderPage();
    }
  }

  async previousPage(): Promise<void> {
    const page = this.documents.page();
    if (page && page.hasPrev) {
      this.clearSelection();
      await this.documents.load({ page: page.page - 1, pageSize: page.pageSize });
      this.rememberCurrentFolderPage();
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
    this.folderPages.set({});
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
    this.folderPages.set({});
    this.clearSelection();
    void this.documents.load({ page: 1, direction: direction });
  }

  setGroupDirection(direction: DocumentSortDirection): void {
    if (!this.canLeaveMetadata()) return;
    this.groupDirection.set(direction);
    localStorage.setItem('binder.documents.groupDirection', direction);
    this.folderPages.set({});
    this.clearSelection();
    void this.documents.load({ page: 1, groupDirection: direction });
  }

  markDocumentReviewed(uuid: string): void {
    this.documents.page.update((page) => page ? {
      ...page,
      items: page.items.map((document) => document.uuid === uuid ? { ...document, isNew: false } : document)
    } : page);
  }

  async metadataSaved(uuid: string): Promise<void> {
    this.markDocumentReviewed(uuid);
    await this.documents.load();
  }


  async requeueDocument(uuid:string) {
    await this.documents.requeueDocument(uuid);
  }

  toggleMetadata(uuid: string): void {
    if (this.drawerDocumentUuid() === uuid && this.drawerTab() === 'metadata') {
      this.requestCloseMetadata();
      return;
    }
    if (!this.canLeaveMetadata()) return;

    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.drawerTab.set('metadata');
    this.drawerDocumentSnapshot.set(this.findDocument(uuid));
    this.drawerDocumentUuid.set(uuid);
  }

  requestCloseMetadata(): void {
    if (!this.drawerDocumentUuid()) return;
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
    this.drawerDocumentUuid.set(null);
    this.drawerDocumentSnapshot.set(null);
  }

  openDocument(uuid: string): void {
    if (!this.canLeaveMetadata()) return;
    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.drawerTab.set('preview');
    this.drawerDocumentSnapshot.set(this.findDocument(uuid));
    this.drawerDocumentUuid.set(uuid);
  }

  private canLeaveMetadata(): boolean {
    if (!this.drawerDocumentUuid() || !this.metadataDirty()) return true;
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
      if (this.drawerDocumentUuid() !== uuid && !this.canLeaveMetadata()) return;
      this.drawerTab.set('metadata');
      this.drawerDocumentSnapshot.set(this.findDocument(uuid));
      this.drawerDocumentUuid.set(uuid);
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

  private findDocument(uuid: string): Document | null {
    return this.documents.page()?.items.find((document) => document.uuid === uuid) ?? null;
  }

  private async loadFolderPage(folderUuid: string | null): Promise<void> {
    const rememberedPage = this.folderPages()[this.folderPageKey(folderUuid)] ?? 1;

    await this.documents.load({
      page: rememberedPage,
      folderUuid: folderUuid ?? undefined
    });

    if (this.documents.error()) return;

    const page = this.documents.page();
    if (!page) return;

    const fallbackPage = this.getFallbackPage(page.page, page.totalPages);
    if (fallbackPage !== null) {
      this.rememberFolderPage(folderUuid, fallbackPage);
      await this.documents.load({ page: fallbackPage });
      return;
    }

    this.rememberFolderPage(folderUuid, page.page);
  }

  private applyListQuery(query: Partial<DocumentListQuery>): void {
    this.activeFilterMenu.set(null);
    this.folderPages.set({});
    this.clearSelection();
    void this.documents.load({ page: 1, ...query });
  }

  private buildFilterQuery(): Partial<DocumentListQuery> {
    const filters = this.filterValues();
    const q = this.listSearch().trim();
    return {
      q: q || undefined,
      status: undefined,
      issuerUuid: undefined,
      documentTypeUuids: filters.documentType,
      categoryUuids: filters.category,
      issuerUuids: filters.issuer,
      tagUuids: filters.tag,
      statuses: filters.status,
      reviewStates: filters.reviewState
    };
  }

  private facetLabel(key: DocumentFilterKey, option: DocumentListFacetOption): string {
    if (key === 'status') return this.i18n.t('documents.status.' + option.value);
    if (key === 'reviewState') return this.i18n.t(option.value === 'new' ? 'documents.new' : 'documents.reviewed');
    if (key === 'documentType' || key === 'category' || key === 'tag') {
      return this.i18n.name({ name: option.label, translations: option.translations });
    }
    return option.label;
  }

  private rememberCurrentFolderPage(): void {
    const page = this.documents.page();
    if (!page) return;

    this.rememberFolderPage(this.folders.selectedFolderUuid(), page.page);
  }

  private rememberFolderPage(folderUuid: string | null, page: number): void {
    this.folderPages.update((pages) => ({
      ...pages,
      [this.folderPageKey(folderUuid)]: page
    }));
  }

  private folderPageKey(folderUuid: string | null): string {
    return folderUuid ?? this.allDocumentsFolderKey;
  }

  private getFallbackPage(page: number, totalPages: number): number | null {
    if (totalPages === 0 && page > 1) return 1;
    if (totalPages > 0 && page > totalPages) return totalPages;
    return null;
  }

  private sortGroups(groups: DocumentGroup[]): DocumentGroup[] {
    const direction = this.groupDirection() === 'asc' ? 1 : -1;
    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: 'base'
    });

    return groups.sort((left, right) => {
      if (left.label === null) return right.label === null ? 0 : 1;
      if (right.label === null) return -1;

      return collator.compare(left.label, right.label) * direction;
    });
  }

  private readGroupDirection(): DocumentSortDirection {
    const stored = localStorage.getItem('binder.documents.groupDirection');
    return stored === 'asc' || stored === 'desc' ? stored : 'asc';
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
