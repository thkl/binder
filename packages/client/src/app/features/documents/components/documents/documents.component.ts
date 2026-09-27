import { ChangeDetectionStrategy, Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { DocumentMetadataEditorComponent } from '../../../metadata/components/document-metadata-editor/document-metadata-editor.component';
import { DocumentViewerComponent } from '../../../../common/components/document-viewer/document-viewer.component';
import type { Document, DocumentTitleSuggestion } from '@binder/common';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';
import type { Document as CommonDocument } from '@binder/common';

type DocumentViewMode = 'list' | 'details' | 'small-icons' | 'large-icons';
type DocumentGroupMode = 'none' | 'documentType' | 'category' | 'issuer' | 'tag';
type DocumentGroup = { key: string; label: string | null; documents: CommonDocument[] };

@Component({
  selector: 'binder-documents',
  standalone: true,
  imports: [CommonModule, DocumentMetadataEditorComponent, DocumentViewerComponent, TranslatePipe],
  templateUrl: './documents.component.html',
  styleUrl: './documents.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentsComponent implements OnInit {
  readonly documents = inject(DocumentsService);
  readonly thumbnailFailed = signal<Record<string, boolean>>({});
  readonly viewMode = signal<DocumentViewMode>(this.readViewMode());
  readonly groupMode = signal<DocumentGroupMode>(this.readGroupMode());
  readonly metadataDocumentUuid = signal<string | null>(null);
  readonly titleSuggestions = signal<Record<string, DocumentTitleSuggestion>>({});
  readonly titleSuggestionLoading = signal<Record<string, boolean>>({});
  readonly viewerDocumentUuid = signal<string | null>(null);
  
  readonly metadataDocument = computed(() => {
    const uuid = this.metadataDocumentUuid();
    return this.documents.page()?.items.find((document) => document.uuid === uuid) ?? null;
  });
  
  readonly documentData = computed(()=>{
    const metadataDocument = this.metadataDocument();
    if (metadataDocument) {
      return metadataDocument as Document
    }
    return null;
  })

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
      const values = mode === 'documentType'
        ? document.metadataSummary.documentType ? [{ key: document.metadataSummary.documentType.uuid, label: document.metadataSummary.documentType.name }] : []
        : mode === 'category'
          ? document.metadataSummary.category ? [{ key: document.metadataSummary.category.uuid, label: document.metadataSummary.category.name }] : []
          : mode === 'issuer'
            ? document.metadataSummary.issuer ? [{ key: document.metadataSummary.issuer.uuid, label: document.metadataSummary.issuer.name }] : []
            : document.metadataSummary.tags.map((tag) => ({ key: tag.uuid, label: tag.name }));
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
    void this.documents.load();
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
      await this.documents.load({ page: page.page + 1, pageSize: page.pageSize });
    }
  }

  async previousPage(): Promise<void> {
    const page = this.documents.page();
    if (page && page.hasPrev) {
      await this.documents.load({ page: page.page - 1, pageSize: page.pageSize });
    }
  }

  thumbnailUrl(uuid: string): string | null {
    return this.documents.page()?.items.find((document) => document.uuid === uuid)?.thumbnailUrl ?? null;
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
    this.groupMode.set(mode);
    localStorage.setItem('binder.documents.group-mode', mode);
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
    this.viewerDocumentUuid.set(null);
    this.metadataDocumentUuid.update((current) => current === uuid ? null : uuid);
  }

  closeMetadata(): void {
    this.metadataDocumentUuid.set(null);
  }

  openDocument(event: Event, uuid: string): void {
    event.preventDefault();
    this.metadataDocumentUuid.set(null);
    this.viewerDocumentUuid.set(uuid);
  }

  closeDocumentViewer(): void {
    this.viewerDocumentUuid.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMetadata();
    this.closeDocumentViewer();
  }

  async renameDocument(uuid: string, event: Event): Promise<void> {
    const title = (event.target as HTMLInputElement).value.trim();
    if (title) await this.documents.updateTitle(uuid, title);
  }

  async suggestTitle(uuid: string): Promise<void> {
    this.titleSuggestionLoading.update((current) => ({ ...current, [uuid]: true }));
    const suggestion = await this.documents.suggestTitle(uuid);
    this.titleSuggestionLoading.update((current) => ({ ...current, [uuid]: false }));
    if (suggestion) {
      this.titleSuggestions.update((current) => ({ ...current, [uuid]: suggestion }));
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

  private readGroupMode(): DocumentGroupMode {
    const stored = localStorage.getItem('binder.documents.group-mode');
    return stored === 'documentType' || stored === 'category' || stored === 'issuer' || stored === 'tag' ? stored : 'none';
  }
  
  private readViewMode(): DocumentViewMode {
    const stored = localStorage.getItem('binder.documents.view-mode');
    return stored === 'details' || stored === 'small-icons' || stored === 'large-icons'
      ? stored
      : 'list';
  }
}
