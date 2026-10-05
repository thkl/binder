import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { FoldersService } from '../../services/folders.service';
import {
  DocumentDrawerComponent,
  DocumentDrawerMode,
  DocumentDrawerTab,
} from '../document-drawer/document-drawer.component';
import { DocumentActionsComponent } from '../document-actions/document-actions.component';
import { DocumentFilterMenuComponent } from '../document-filter-menu/document-filter-menu.component';
import { FolderTreeComponent } from '../folder-tree/folder-tree.component';
import { SavedSearchMenuComponent } from '../saved-search-menu/saved-search-menu.component';
import { BulkMetadataDialogComponent } from '../bulk-metadata-dialog/bulk-metadata-dialog.component';
import type { SavedSearchParameter } from '../saved-search-menu/saved-search-menu.component';
import { SavedSearchService } from '../../services/saved-search.service';
import { MetadataService } from '../../../metadata/services/metadata.service';
import type {
  BulkMetadataApplyResponse,
  Document,
  DocumentBulkAction,
  DocumentBulkActionResponse,
  DocumentListFacetOption,
  DocumentListQuery,
  DocumentGroupBy,
  DocumentStatus,
  DocumentTitleSuggestion,
} from '@binder/common';
import { DocumentListQuerySchema } from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { ConfirmDialogComponent } from '../../../../common/components/confirm-dialog/confirm-dialog.component';
import { InboxService } from '../../../inbox/services/inbox.service';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map } from 'rxjs';

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
    SavedSearchMenuComponent,
    BulkMetadataDialogComponent,
    ConfirmDialogComponent,
    TranslatePipe,
  ],
  templateUrl: './documents.component.html',
  styleUrl: './documents.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentsComponent implements OnInit, OnDestroy {
  readonly documents = inject(DocumentsService);
  readonly folders = inject(FoldersService);
  readonly savedSearches = inject(SavedSearchService);
  readonly metadata = inject(MetadataService);
  readonly inbox = inject(InboxService);
  private readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  readonly thumbnailFailed = signal<Record<string, boolean>>({});
  readonly viewMode = signal<DocumentViewMode>(this.readViewMode());
  readonly groupMode = signal<DocumentGroupMode>(this.readGroupMode());
  readonly sortDirection = signal<DocumentSortDirection>(this.readSortDirection());
  readonly groupDirection = signal<DocumentSortDirection>(this.readGroupDirection());
  readonly drawerDocumentUuid = signal<string | null>(null);
  readonly drawerTab = signal<DocumentDrawerTab>('preview');
  readonly drawerMode = signal<DocumentDrawerMode>('analysis');
  readonly drawerDocumentSnapshot = signal<Document | null>(null);
  readonly unassignedFolderSelected = signal(false);
  readonly newDocumentsSelected = signal(false);
  readonly titleSuggestions = signal<Record<string, DocumentTitleSuggestion>>({});
  readonly titleSuggestionLoading = signal<Record<string, boolean>>({});
  readonly requeueLoading = signal<Record<string, boolean>>({});
  readonly editingTitleUuid = signal<string | null>(null);
  readonly metadataDirty = signal(false);
  readonly metadataClosePrompt = signal(false);
  readonly deleteDialogUuid = signal<string | null>(null);
  readonly duplicateDocumentLoading = signal(false);
  readonly selectedDocumentUuids = signal<Set<string>>(new Set());
  readonly bulkActionInProgress = signal<DocumentBulkAction | null>(null);
  readonly bulkActionResult = signal<DocumentBulkActionResponse | null>(null);
  readonly folderActionInProgress = signal<'add' | 'remove' | null>(null);
  readonly folderActionMessage = signal<string | null>(null);
  readonly bulkMetadataDialogOpen = signal(false);
  readonly bulkMetadataMessage = signal<string | null>(null);
  readonly emptyDropActive = signal(false);
  readonly emptyUploadMessage = signal<'success' | null>(null);
  readonly emptyUploadError = signal<string | null>(null);
  readonly emptyUploadTotal = signal(0);
  readonly emptyUploadCompleted = signal(0);
  readonly emptyUploadedCount = signal(0);
  readonly listSearch = signal('');
  readonly activeFilterMenu = signal<DocumentFilterKey | null>(null);
  readonly selectedSavedSearchUuid = signal<string | null>(null);
  readonly filterValues = signal<DocumentFilterValues>({
    documentType: undefined,
    category: undefined,
    issuer: undefined,
    tag: undefined,
    status: undefined,
    reviewState: undefined,
  });
  private readonly router = inject(Router);
  private readonly activeRoute = inject(ActivatedRoute);

  private selectedFolderID = toSignal(
    this.activeRoute.paramMap.pipe(map(params => params.get('folderid')), distinctUntilChanged())
  );

  private readonly folderPages = signal<Record<string, number>>({});
  private readonly allDocumentsFolderKey = '__all-documents__';
  private readonly unassignedFolderKey = '__unassigned-documents__';
  private readonly newDocumentsFolderKey = '__new-documents__';
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private processingRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private processingRefreshRun = 0;
  private readonly processingRefreshIntervalMs = 2_000;

  private lastDocumentChangeRevision = 0;
  private readonly documentChangeEffect = effect(() => {
    const revision = this.inbox.documentChangeRevision();
    if (revision === 0 || revision === this.lastDocumentChangeRevision) return;

    this.lastDocumentChangeRevision = revision;
    void this.refreshDocumentView();
  });

  readonly drawerDocument = computed(() => {
    const uuid = this.drawerDocumentUuid();
    const current = this.documents.page()?.items.find((document) => document.uuid === uuid);
    return current ?? this.drawerDocumentSnapshot();
  });

  readonly selectedCount = computed(() => this.selectedDocumentUuids().size);
  readonly selectedDocumentUuidList = computed(() => [...this.selectedDocumentUuids()]);
  readonly bulkDocumentTypes = computed(() => this.metadata.vocabulary()?.documentTypes ?? []);
  readonly bulkCategories = computed(() => this.metadata.vocabulary()?.categories ?? []);
  readonly bulkTags = computed(() => this.metadata.vocabulary()?.tags ?? []);
  readonly activeFilterCount = computed(() => {
    const values = this.filterValues();
    const selectedFilters = Object.values(values).filter(
      (selection) => selection !== undefined,
    ).length;
    return selectedFilters + (this.listSearch().trim() ? 1 : 0);
  });
  readonly hasActiveFilters = computed(() => this.activeFilterCount() > 0);
  readonly savedSearchParameters = computed<SavedSearchParameter[]>(() =>
    this.createSavedSearchParameters(),
  );
  readonly exportScope = computed<'selected' | 'filtered' | 'folder' | null>(() => {
    if (this.selectedCount() > 0) return 'selected';
    if (this.unassignedFolderSelected() || this.newDocumentsSelected()) return 'filtered';
    if (this.hasActiveFilters()) return 'filtered';
    return this.folders.selectedFolderUuid() ? 'folder' : null;
  });
  readonly exportInProgress = computed(
    () => this.documents.exporting() || this.folders.exportingFolderUuid() !== null,
  );
  readonly allVisibleSelected = computed(() => {
    const visible = this.documents.page()?.items ?? [];
    return (
      visible.length > 0 &&
      visible.every((document) => this.selectedDocumentUuids().has(document.uuid))
    );
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
        const group = groups.get(value.key) ?? {
          key: value.key,
          label: value.label,
          documents: [],
        };
        group.documents.push(document);
        groups.set(value.key, group);
      }
    }
    return this.sortGroups([...groups.values()]);
  });

  constructor() {
    effect(async () => {
      const folderUuid = this.selectedFolderID();
      if (folderUuid) {
        untracked(async () => {
          switch (folderUuid) {
            case 'unassigned':
              console.log('Selecting unassigned');
              this.activeFilterMenu.set(null);
              this.selectedSavedSearchUuid.set(null);
              this.rememberCurrentFolderPage();
              this.unassignedFolderSelected.set(true);
              this.newDocumentsSelected.set(false);
              this.folders.select(null);
              await this.loadFolderPage(null, true);
              break;
            case 'new':
              console.log('Selecting new')
              this.activeFilterMenu.set(null);
              this.selectedSavedSearchUuid.set(null);
              this.rememberCurrentFolderPage();
              this.unassignedFolderSelected.set(false);
              this.newDocumentsSelected.set(true);
              this.filterValues.update((current) => ({ ...current, reviewState: undefined }));
              this.folders.select(null);
              await this.loadFolderPage(null, false, true);
              break;
            default:
              console.log("Loading Folder Documents ", folderUuid)
              this.activeFilterMenu.set(null);
              this.selectedSavedSearchUuid.set(null);
              this.rememberCurrentFolderPage();
              this.unassignedFolderSelected.set(false);
              this.newDocumentsSelected.set(false);
              this.folders.select(folderUuid);
              await this.loadFolderPage(folderUuid, false);
          }
        });
      } else {
        void this.documents.load({
          groupBy: this.groupMode(),
          folderUuid: undefined,
          unassigned: false,
        });
      }
    })
  }


  ngOnInit(): void {
    this.lastDocumentChangeRevision = this.inbox.documentChangeRevision();
    this.unassignedFolderSelected.set(false);
    this.newDocumentsSelected.set(false);
    this.folders.select(null);
    void this.folders.loadChildren(null);
    void this.folders.listAll();
    void this.metadata.loadVocabulary();
    void this.savedSearches.load();
/*
    void this.documents.load({
      groupBy: this.groupMode(),
      folderUuid: undefined,
      unassigned: false,
    });
    */
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.stopProcessingRefresh();
  }

  async selectFolder(folderUuid: string | null): Promise<void> {
    if (!this.canLeaveMetadata()) return;
    this.documents.duplicateUpload.set(false);
    if (folderUuid !== null) {
      this.router.navigate(['documents', folderUuid]);
    } else {
      this.router.navigate(['documents']);
    }
  }

  async selectUnassigned(): Promise<void> {
    if (!this.canLeaveMetadata()) return;
    this.router.navigate(['documents', 'unassigned']);
  }

  async selectNewDocuments(): Promise<void> {
    if (!this.canLeaveMetadata()) return;
    this.router.navigate(['documents', 'new'])

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
    this.selectedSavedSearchUuid.set(null);
    if (this.searchTimer) clearTimeout(this.searchTimer);

    this.searchTimer = setTimeout(() => {
      this.applyListQuery(this.buildFilterQuery());
    }, 300);
  }

  toggleFilterMenu(key: DocumentFilterKey): void {
    this.activeFilterMenu.update((current) => (current === key ? null : key));
  }

  closeFilterMenu(): void {
    this.activeFilterMenu.set(null);
  }

  applyFilter(key: DocumentFilterKey, values: string[] | undefined): void {
    if (!this.canLeaveMetadata()) return;

    if (key === 'reviewState') {
      this.newDocumentsSelected.set(false);
    }
    this.filterValues.update((current) => ({ ...current, [key]: values }));
    this.selectedSavedSearchUuid.set(null);
    this.applyListQuery(this.buildFilterQuery());
  }

  clearAllFilters(): void {
    if (!this.canLeaveMetadata()) return;

    this.listSearch.set('');
    this.selectedSavedSearchUuid.set(null);
    this.filterValues.set({
      documentType: undefined,
      category: undefined,
      issuer: undefined,
      tag: undefined,
      status: undefined,
      reviewState: undefined,
    });
    this.applyListQuery(this.buildFilterQuery());
  }

  facetOptions(key: DocumentFilterKey): DocumentListFacetOption[] {
    const options = this.documents.facets()?.[key] ?? [];
    return options
      .map((option) => ({
        ...option,
        label: this.facetLabel(key, option),
      }))
      .sort((left, right) =>
        left.label.localeCompare(right.label, undefined, { sensitivity: 'base', numeric: true }),
      );
  }

  async changeFolderMembership(action: 'add' | 'remove'): Promise<void> {
    const folderUuid = this.folders.selectedFolderUuid();
    if (!folderUuid || this.selectedCount() === 0 || this.folderActionInProgress()) return;
    this.folderActionInProgress.set(action);
    this.folderActionMessage.set(null);
    const result =
      action === 'add'
        ? await this.folders.linkDocuments(folderUuid, [...this.selectedDocumentUuids()])
        : await this.folders.unlinkDocuments(folderUuid, [...this.selectedDocumentUuids()]);
    this.folderActionInProgress.set(null);
    if (result) {
      this.folderActionMessage.set(
        `${result.affected} ${action === 'add' ? 'document(s) added to' : 'document(s) removed from'} folder.`,
      );
      this.clearSelection();
      await this.documents.load();
    }
  }

  openBulkMetadata(): void {
    if (this.selectedCount() === 0) return;
    this.bulkMetadataMessage.set(null);
    this.bulkMetadataDialogOpen.set(true);
  }

  async bulkMetadataApplied(result: BulkMetadataApplyResponse): Promise<void> {
    this.bulkMetadataDialogOpen.set(false);
    this.bulkMetadataMessage.set(
      `${result.applied} ${this.i18n.t('documents.bulkMetadataUpdated')}.`,
    );
    this.clearSelection();
    await this.documents.load();
  }

  async fileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.documents.clearUploadNotice();
    if (!file) {
      return;
    }
    if (file.type !== 'application/pdf') {
      this.documents.error.set('Only PDF documents are supported.');
      return;
    }
    await this.documents.upload(file);
  }

  onEmptyDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.documents.uploading()) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.emptyDropActive.set(true);
  }

  onEmptyDragLeave(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement;
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && target.contains(relatedTarget)) return;
    this.emptyDropActive.set(false);
  }

  async onEmptyDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.emptyDropActive.set(false);
    if (this.documents.uploading()) return;
    await this.uploadEmptyFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  async emptyFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    await this.uploadEmptyFiles(files);
  }

  private async uploadEmptyFiles(files: File[]): Promise<void> {
    this.emptyUploadMessage.set(null);
    this.emptyUploadError.set(null);
    this.documents.clearUploadNotice();
    this.emptyUploadTotal.set(files.length);
    this.emptyUploadCompleted.set(0);
    this.emptyUploadedCount.set(0);
    if (files.length === 0) return;

    const pdfFiles = files.filter((file) => this.isPdf(file));
    if (pdfFiles.length !== files.length) {
      this.emptyUploadError.set(this.i18n.t('home.uploadOnlyPdf'));
    }
    this.emptyUploadTotal.set(pdfFiles.length);
    if (pdfFiles.length === 0) return;

    let failedCount = 0;
    for (const file of pdfFiles) {
      const uploaded = await this.documents.upload(file);
      if (uploaded) this.emptyUploadedCount.update((count) => count + 1);
      else failedCount += 1;
      this.emptyUploadCompleted.update((count) => count + 1);
    }

    if (this.emptyUploadedCount() > 0) this.emptyUploadMessage.set('success');
    if (failedCount > 0 && !this.emptyUploadError()) {
      this.emptyUploadError.set(this.documents.error() ?? this.i18n.t('home.uploadFailed'));
    }
  }

  private isPdf(file: File): boolean {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
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

    const documentUuids = [...this.selectedDocumentUuids()];
    this.bulkActionInProgress.set(action);
    this.bulkActionResult.set(null);
    const result = await this.documents.bulkAction({
      documentUuids,
      action,
    });
    this.bulkActionInProgress.set(null);
    if (result) {
      this.selectedDocumentUuids.set(new Set());
      this.bulkActionResult.set(result);
      if (action === 'mark-reviewed') {
        await this.inbox.loadNewDocumentCount();
      }
      this.startProcessingRefresh(documentUuids);
    }
  }

  private startProcessingRefresh(documentUuids: string[]): void {
    this.stopProcessingRefresh();

    if (documentUuids.length === 0) return;

    const run = this.processingRefreshRun;
    void this.refreshDocumentsUntilComplete(new Set(documentUuids), run);
  }

  private async refreshDocumentsUntilComplete(
    documentUuids: Set<string>,
    run: number,
  ): Promise<void> {
    while (documentUuids.size > 0 && run === this.processingRefreshRun) {
      const results = await Promise.all(
        [...documentUuids].map(async (uuid) => ({
          uuid,
          document: await this.documents.refreshDocument(uuid),
        })),
      );

      for (const result of results) {
        if (result.document && this.isProcessingComplete(result.document.status)) {
          documentUuids.delete(result.uuid);
        }
      }

      if (documentUuids.size === 0 || run !== this.processingRefreshRun) return;

      await new Promise<void>((resolve) => {
        this.processingRefreshTimer = window.setTimeout(resolve, this.processingRefreshIntervalMs);
      });
      this.processingRefreshTimer = null;
    }
  }

  private isProcessingComplete(status: DocumentStatus): boolean {
    return status === 'ready' || status === 'failed' || status === 'quarantined';
  }

  private stopProcessingRefresh(): void {
    this.processingRefreshRun += 1;
    if (this.processingRefreshTimer) {
      clearTimeout(this.processingRefreshTimer);
      this.processingRefreshTimer = null;
    }
  }

  thumbnailUrl(uuid: string): string | null {
    return (
      this.documents.page()?.items.find((document) => document.uuid === uuid)?.thumbnailUrl ?? null
    );
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
      console.log('canLeaveMetadata is false');
      return;
    }
    console.log('Set Group Mode ', mode);
    this.groupMode.set(mode);
    this.selectedSavedSearchUuid.set(null);
    localStorage.setItem('binder.documents.group-mode', mode);
    this.folderPages.set({});
    this.clearSelection();
    void this.documents.load({ page: 1, groupBy: mode });
  }

  setSortDirection(direction: DocumentSortDirection): void {
    if (!this.canLeaveMetadata()) {
      console.log('canLeaveMetadata is false');
      return;
    }
    console.log('Set SortDirection', direction);
    this.sortDirection.set(direction);
    this.selectedSavedSearchUuid.set(null);
    localStorage.setItem('binder.documents.sortDirection', direction);
    this.folderPages.set({});
    this.clearSelection();
    void this.documents.load({ page: 1, direction: direction });
  }

  setGroupDirection(direction: DocumentSortDirection): void {
    if (!this.canLeaveMetadata()) return;
    this.groupDirection.set(direction);
    this.selectedSavedSearchUuid.set(null);
    localStorage.setItem('binder.documents.groupDirection', direction);
    this.folderPages.set({});
    this.clearSelection();
    void this.documents.load({ page: 1, groupDirection: direction });
  }

  markDocumentReviewed(uuid: string): void {
    this.documents.page.update((page) =>
      page
        ? {
          ...page,
          items: page.items.map((document) =>
            document.uuid === uuid ? { ...document, isNew: false } : document,
          ),
        }
        : page,
    );
  }

  async metadataSaved(uuid: string): Promise<void> {
    this.markDocumentReviewed(uuid);
    await this.documents.load();
    await this.inbox.loadNewDocumentCount();
  }

  async requeueDocument(uuid: string): Promise<void> {
    this.requeueLoading.update((current) => ({ ...current, [uuid]: true }));
    try {
      await this.documents.requeueDocument(uuid);
    } finally {
      this.requeueLoading.update((current) => ({ ...current, [uuid]: false }));
    }
  }

  async generateArchive(uuid: string): Promise<void> {
    await this.documents.generateArchive(uuid);
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
      this.finishCloseMetadata();
    }
    if (deleted) this.clearSelection();
  }

  documentLabel(uuid: string): string {
    const document = this.documents.page()?.items.find((item) => item.uuid === uuid);
    return document?.title || document?.originalFilename || uuid;
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
    this.drawerMode.set('analysis');
    this.drawerDocumentSnapshot.set(this.findDocument(uuid));
    this.drawerDocumentUuid.set(uuid);
    void this.documents.markOpened(uuid);
  }

  toggleMetadata(uuid: string): void {
    if (!this.canLeaveMetadata()) return;

    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.drawerTab.set('metadata');
    this.drawerMode.set('analysis');
    this.drawerDocumentSnapshot.set(this.findDocument(uuid));
    this.drawerDocumentUuid.set(uuid);
    void this.documents.markOpened(uuid);
  }

  private canLeaveMetadata(): boolean {
    if (!this.drawerDocumentUuid() || !this.metadataDirty()) return true;
    this.metadataClosePrompt.set(true);
    return false;
  }

  async renameDocument(uuid: string, event: Event): Promise<void> {
    const title = (event.target as HTMLInputElement).value.trim();
    if (title && (await this.documents.updateTitle(uuid, title))) {
      await this.inbox.loadNewDocumentCount();
    }
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

      // When the document is already open in the analysis drawer, keep the
      // current view. The updated suggestion is passed into the drawer and
      // its metadata tab can be opened deliberately by the user.
      if (this.drawerDocumentUuid() === uuid) return;
      if (!this.canLeaveMetadata()) return;

      this.drawerTab.set('metadata');
      this.drawerMode.set('metadata');
      this.drawerDocumentSnapshot.set(this.findDocument(uuid));
      this.drawerDocumentUuid.set(uuid);
    }
  }

  async acceptTitleSuggestion(uuid: string): Promise<void> {
    const suggestion = this.titleSuggestions()[uuid];
    if (!suggestion || !(await this.documents.updateTitle(uuid, suggestion.suggestedTitle))) return;
    this.titleSuggestions.update((current) => {
      const next = { ...current };
      delete next[uuid];
      return next;
    });
  }

  async dismissTitleSuggestion(uuid: string): Promise<void> {
    if ((await this.documents.clearSuggestion(uuid)) === null) return;
    this.titleSuggestions.update((current) => {
      const next = { ...current };
      delete next[uuid];
      return next;
    });
  }

  acceptSuggestedMetadata(uuid: string, _title: string): void {
    this.titleSuggestions.update((current) => {
      const next = { ...current };
      delete next[uuid];
      return next;
    });
  }

  async acceptSuggestedTitleValue(uuid: string, title: string): Promise<void> {
    await this.documents.updateTitle(uuid, title);
  }

  dismissLocalTitleSuggestion(uuid: string): void {
    this.titleSuggestions.update((current) => {
      const next = { ...current };
      delete next[uuid];
      return next;
    });
  }

  private readSortDirection(): DocumentSortDirection {
    const stored = localStorage.getItem('binder.documents.sortDirection');
    return stored === 'asc' || stored === 'desc' ? stored : 'desc';
  }

  private findDocument(uuid: string): Document | null {
    return this.documents.page()?.items.find((document) => document.uuid === uuid) ?? null;
  }

  private async refreshDocumentView(): Promise<void> {
    await this.documents.refreshCurrentPage();
    this.rememberCurrentFolderPage();
  }

  private async loadFolderPage(
    folderUuid: string | null,
    unassigned: boolean,
    newDocuments = false,
  ): Promise<void> {
    const rememberedPage =
      this.folderPages()[this.folderPageKey(folderUuid, unassigned, newDocuments)] ?? 1;

    await this.documents.load({
      page: rememberedPage,
      folderUuid: folderUuid ?? undefined,
      unassigned,
      reviewStates: newDocuments ? ['new'] : this.filterValues().reviewState,
    });

    if (this.documents.error()) return;

    const page = this.documents.page();
    if (!page) return;

    const fallbackPage = this.getFallbackPage(page.page, page.totalPages);
    if (fallbackPage !== null) {
      this.rememberFolderPage(folderUuid, fallbackPage, unassigned, newDocuments);
      await this.documents.load({
        page: fallbackPage,
        folderUuid: folderUuid ?? undefined,
        unassigned,
        reviewStates: newDocuments ? ['new'] : this.filterValues().reviewState,
      });
      return;
    }

    this.rememberFolderPage(folderUuid, page.page, unassigned, newDocuments);
  }

  private applyListQuery(query: Partial<DocumentListQuery>): void {
    this.activeFilterMenu.set(null);
    this.selectedSavedSearchUuid.set(null);
    this.folderPages.set({});
    this.clearSelection();
    void this.documents.load({ page: 1, ...query });
  }

  private buildFilterQuery(): Partial<DocumentListQuery> {
    const filters = this.filterValues();
    const q = this.listSearch().trim();
    return {
      folderUuid: this.unassignedFolderSelected()
        ? undefined
        : (this.folders.selectedFolderUuid() ?? undefined),
      unassigned: this.unassignedFolderSelected() ? true : undefined,
      q: q || undefined,
      status: undefined,
      issuerUuid: undefined,
      documentTypeUuids: filters.documentType,
      categoryUuids: filters.category,
      issuerUuids: filters.issuer,
      tagUuids: filters.tag,
      statuses: filters.status,
      reviewStates: this.newDocumentsSelected() ? ['new'] : filters.reviewState,
    };
  }

  async saveCurrentSearch(name: string): Promise<void> {
    const parsed = this.currentSavedSearchQuery();
    const { page: _page, ...query } = parsed;
    const saved = await this.savedSearches.create({
      name,
      definition: { kind: 'list', query },
    });
    if (saved) this.selectedSavedSearchUuid.set(saved.uuid);
  }

  async loadSavedSearch(uuid: string): Promise<void> {
    if (!uuid) {
      this.selectedSavedSearchUuid.set(null);
      return;
    }

    const saved = this.savedSearches.items().find((item) => item.uuid === uuid);
    if (!saved || saved.definition.kind !== 'list' || !this.canLeaveMetadata()) return;

    const query = saved.definition.query;
    this.selectedSavedSearchUuid.set(saved.uuid);
    this.listSearch.set(query.q ?? '');
    this.filterValues.set({
      documentType: query.documentTypeUuids,
      category: query.categoryUuids,
      issuer: query.issuerUuids,
      tag: query.tagUuids,
      status: query.statuses,
      reviewState: query.reviewStates,
    });
    this.groupMode.set(query.groupBy ?? 'none');
    this.groupDirection.set(query.groupDirection ?? 'asc');
    this.sortDirection.set(query.direction ?? 'desc');
    localStorage.setItem('binder.documents.group-mode', this.groupMode());
    localStorage.setItem('binder.documents.groupDirection', this.groupDirection());
    localStorage.setItem('binder.documents.sortDirection', this.sortDirection());
    this.unassignedFolderSelected.set(query.unassigned === true);
    this.newDocumentsSelected.set(
      !query.folderUuid &&
      query.unassigned !== true &&
      query.reviewStates?.length === 1 &&
      query.reviewStates[0] === 'new',
    );
    this.folders.select(this.unassignedFolderSelected() ? null : (query.folderUuid ?? null));
    this.activeFilterMenu.set(null);
    this.folderPages.set({});
    this.clearSelection();
    await this.documents.load({ ...query, page: 1 });
  }

  async removeSavedSearch(uuid: string): Promise<void> {
    if (!window.confirm(this.i18n.t('documents.savedSearchDeleteConfirm'))) return;
    if ((await this.savedSearches.remove(uuid)) && this.selectedSavedSearchUuid() === uuid) {
      this.selectedSavedSearchUuid.set(null);
    }
  }

  async renameSavedSearch(input: { uuid: string; name: string }): Promise<void> {
    const updated = await this.savedSearches.update(input.uuid, { name: input.name });
    if (updated) this.selectedSavedSearchUuid.set(updated.uuid);
  }

  private currentSavedSearchQuery(): DocumentListQuery {
    const current = this.documents.getCurrentQuery();
    return DocumentListQuerySchema.parse({
      ...this.buildFilterQuery(),
      pageSize: current.pageSize,
      sort: current.sort,
      direction: this.sortDirection(),
      groupBy: this.groupMode(),
      groupDirection: this.groupDirection(),
      folderUuid: current.folderUuid,
      unassigned: this.unassignedFolderSelected(),
    });
  }

  private createSavedSearchParameters(): SavedSearchParameter[] {
    const query = this.currentSavedSearchQuery();
    return [
      {
        label: this.i18n.t('documents.searchList'),
        value: query.q || this.i18n.t('documents.savedSearchAnyValue'),
      },
      {
        label: this.i18n.t('documents.filterType'),
        value: this.facetSelectionLabel('documentType', query.documentTypeUuids),
      },
      {
        label: this.i18n.t('documents.filterCategory'),
        value: this.facetSelectionLabel('category', query.categoryUuids),
      },
      {
        label: this.i18n.t('documents.filterIssuer'),
        value: this.facetSelectionLabel('issuer', query.issuerUuids),
      },
      {
        label: this.i18n.t('documents.filterTag'),
        value: this.facetSelectionLabel('tag', query.tagUuids),
      },
      {
        label: this.i18n.t('documents.filterStatus'),
        value: this.scalarSelectionLabel(query.statuses, 'documents.status.'),
      },
      {
        label: this.i18n.t('documents.filterReviewState'),
        value: this.scalarSelectionLabel(query.reviewStates, 'documents.'),
      },
      { label: this.i18n.t('folders.allDocuments'), value: this.folderSelectionLabel(query) },
      { label: this.i18n.t('documents.sortDirection'), value: this.sortSelectionLabel(query) },
      { label: this.i18n.t('documents.groupBy'), value: this.groupSelectionLabel(query.groupBy) },
      { label: this.i18n.t('documents.groupDirection'), value: this.groupDirectionLabel(query) },
      { label: this.i18n.t('documents.savedSearchPageSize'), value: String(query.pageSize) },
    ];
  }

  private facetSelectionLabel(key: DocumentFilterKey, values: string[] | undefined): string {
    if (!values || values.length === 0) return this.i18n.t('documents.savedSearchAnyValue');
    const selected = new Set(values);
    const labels = this.facetOptions(key)
      .filter((option) => selected.has(option.value))
      .map((option) => option.label);
    return labels.length > 0
      ? labels.join(', ')
      : `${values.length} ${this.i18n.t('documents.savedSearchSelected')}`;
  }

  private scalarSelectionLabel<T extends string>(values: T[] | undefined, prefix: string): string {
    if (!values || values.length === 0) return this.i18n.t('documents.savedSearchAnyValue');
    return values.map((value) => this.i18n.t(prefix + value)).join(', ');
  }

  private folderSelectionLabel(query: DocumentListQuery): string {
    if (query.unassigned) return this.i18n.t('folders.unassigned');
    if (!query.folderUuid && query.reviewStates?.length === 1 && query.reviewStates[0] === 'new') {
      return this.i18n.t('folders.newDocuments');
    }
    const folderUuid = query.folderUuid;
    if (!folderUuid) return this.i18n.t('folders.allDocuments');
    return (
      this.folders.loadedFolders().find((folder) => folder.uuid === folderUuid)?.name ??
      `${this.i18n.t('documents.savedSearchSelected')}: ${folderUuid}`
    );
  }

  private sortSelectionLabel(query: DocumentListQuery): string {
    const field =
      query.sort === 'createdAt' ? this.i18n.t('documents.savedSearchCreated') : query.sort;
    const direction =
      query.direction === 'asc'
        ? this.i18n.t('documents.sortAsc')
        : this.i18n.t('documents.sortDesc');
    return `${field} · ${direction}`;
  }

  private groupSelectionLabel(groupBy: DocumentGroupBy): string {
    const labels: Record<DocumentGroupBy, string> = {
      none: this.i18n.t('documents.noGrouping'),
      documentType: this.i18n.t('documents.groupType'),
      category: this.i18n.t('documents.groupCategory'),
      issuer: this.i18n.t('documents.groupIssuer'),
      tag: this.i18n.t('documents.groupTag'),
      status: this.i18n.t('documents.groupStatus'),
      isNew: this.i18n.t('documents.groupReviewState'),
    };
    return labels[groupBy];
  }

  private groupDirectionLabel(query: DocumentListQuery): string {
    if (query.groupBy === 'none') return this.i18n.t('documents.savedSearchAnyValue');
    if (query.groupBy === 'isNew') {
      return query.groupDirection === 'asc'
        ? this.i18n.t('documents.reviewedFirst')
        : this.i18n.t('documents.newFirst');
    }
    return query.groupDirection === 'asc'
      ? this.i18n.t('documents.groupAsc')
      : this.i18n.t('documents.groupDesc');
  }

  private facetLabel(key: DocumentFilterKey, option: DocumentListFacetOption): string {
    if (key === 'status') return this.i18n.t('documents.status.' + option.value);
    if (key === 'reviewState')
      return this.i18n.t(option.value === 'new' ? 'documents.new' : 'documents.reviewed');
    if (key === 'documentType' || key === 'category' || key === 'tag') {
      return this.i18n.name({ name: option.label, translations: option.translations });
    }
    return option.label;
  }

  private rememberCurrentFolderPage(): void {
    const page = this.documents.page();
    if (!page) return;

    this.rememberFolderPage(
      this.folders.selectedFolderUuid(),
      page.page,
      this.unassignedFolderSelected(),
      this.newDocumentsSelected(),
    );
  }

  private rememberFolderPage(
    folderUuid: string | null,
    page: number,
    unassigned = false,
    newDocuments = false,
  ): void {
    this.folderPages.update((pages) => ({
      ...pages,
      [this.folderPageKey(folderUuid, unassigned, newDocuments)]: page,
    }));
  }

  private folderPageKey(
    folderUuid: string | null,
    unassigned = false,
    newDocuments = false,
  ): string {
    if (unassigned) return this.unassignedFolderKey;
    if (newDocuments) return this.newDocumentsFolderKey;
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
      sensitivity: 'base',
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
    return stored === 'documentType' ||
      stored === 'category' ||
      stored === 'issuer' ||
      stored === 'tag' ||
      stored === 'status' ||
      stored === 'isNew'
      ? stored
      : 'none';
  }

  private readViewMode(): DocumentViewMode {
    const stored = localStorage.getItem('binder.documents.view-mode');
    return stored === 'small-icons' || stored === 'large-icons' || stored === 'icons'
      ? 'icons'
      : 'list';
  }

  private groupValues(
    document: Document,
    mode: DocumentGroupMode,
  ): Array<{ key: string; label: string | null }> {
    switch (mode) {
      case 'documentType':
        return document.metadataSummary.documentType
          ? [
            {
              key: document.metadataSummary.documentType.uuid,
              label: document.metadataSummary.documentType.name,
            },
          ]
          : [];
      case 'category':
        return document.metadataSummary.category
          ? [
            {
              key: document.metadataSummary.category.uuid,
              label: document.metadataSummary.category.name,
            },
          ]
          : [];
      case 'issuer':
        return document.metadataSummary.issuer
          ? [
            {
              key: document.metadataSummary.issuer.uuid,
              label: document.metadataSummary.issuer.name,
            },
          ]
          : [];
      case 'tag':
        return document.metadataSummary.tags.map((tag) => ({ key: tag.uuid, label: tag.name }));
      case 'status':
        return [
          { key: document.status, label: this.i18n.t('documents.status.' + document.status) },
        ];
      case 'isNew':
        return [
          {
            key: document.isNew ? 'new' : 'reviewed',
            label: this.i18n.t(document.isNew ? 'documents.new' : 'documents.reviewed'),
          },
        ];
      case 'none':
        return [];
    }
  }
}
