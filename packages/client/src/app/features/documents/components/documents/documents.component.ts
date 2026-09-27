import { ChangeDetectionStrategy, Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';
import { DocumentMetadataEditorComponent } from '../../../metadata/components/document-metadata-editor/document-metadata-editor.component';
import { DocumentViewerComponent } from '../../../../common/components/document-viewer/document-viewer.component';
import type { DocumentTitleSuggestion } from '@binder/common';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';

type DocumentViewMode = 'list' | 'details' | 'small-icons' | 'large-icons';

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
  readonly metadataDocumentUuid = signal<string | null>(null);
  readonly titleSuggestions = signal<Record<string, DocumentTitleSuggestion>>({});
  readonly titleSuggestionLoading = signal<Record<string, boolean>>({});
  readonly viewerDocumentUuid = signal<string | null>(null);
  readonly metadataDocument = computed(() => {
    const uuid = this.metadataDocumentUuid();
    return this.documents.page()?.items.find((document) => document.uuid === uuid) ?? null;
  });
  readonly viewerDocument = computed(() => {
    const uuid = this.viewerDocumentUuid();
    return this.documents.page()?.items.find((document) => document.uuid === uuid) ?? null;
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
    return this.documents.thumbnailUrls()[uuid] ?? null;
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

  dismissTitleSuggestion(uuid: string): void {
    this.titleSuggestions.update((current) => { const next = { ...current }; delete next[uuid]; return next; });
  }

  async acceptSuggestedMetadata(uuid: string): Promise<void> {
    const suggestion = this.titleSuggestions()[uuid];
    if (!suggestion) return;
    if (await this.documents.updateTitle(uuid, suggestion.suggestedTitle)) {
      this.titleSuggestions.update((current) => { const next = { ...current }; delete next[uuid]; return next; });
    }
  }

  async acceptSuggestedField(uuid: string, field: string): Promise<void> {
    if (field !== 'title') return;
    const suggestion = this.titleSuggestions()[uuid];
    if (suggestion) await this.documents.updateTitle(uuid, suggestion.suggestedTitle);
  }
  
  private readViewMode(): DocumentViewMode {
    const stored = localStorage.getItem('binder.documents.view-mode');
    return stored === 'details' || stored === 'small-icons' || stored === 'large-icons'
      ? stored
      : 'list';
  }
}
