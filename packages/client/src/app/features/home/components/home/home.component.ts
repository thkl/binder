
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SearchService } from '../../services/search.service';
import { DocumentDrawerComponent, DocumentDrawerTab } from '../../../documents/components/document-drawer/document-drawer.component';
import type { Document } from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';

@Component({
  selector: 'binder-home',
  standalone: true,
  imports: [CommonModule, DocumentDrawerComponent, TranslatePipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomeComponent {
  readonly search = inject(SearchService);
  readonly i18n = inject(I18nService);
  readonly searchQuery = signal('');
  readonly drawerDocumentUuid = signal<string | null>(null);
  readonly drawerTab = signal<DocumentDrawerTab>('preview');
  readonly drawerDocumentSnapshot = signal<Document | null>(null);
  readonly metadataDirty = signal(false);
  readonly metadataClosePrompt = signal(false);
  readonly selectedType = signal('');
  readonly selectedCategory = signal('');
  readonly selectedTag = signal('');
  readonly selectedIssuer = signal('');
  readonly onlySemantic = signal(true);

  readonly drawerDocument = computed(() => {
    const uuid = this.drawerDocumentUuid();
    const current = this.search.result()?.items.find((item) => item.document.uuid === uuid)?.document;
    return current ?? this.drawerDocumentSnapshot();
  });

  searchResult = computed(()=>{
    const result = this.search.result();
    if (result) {
      const sorted = (this.onlySemantic()?result.items.filter(item=>item.semanticScore!==null):result.items).sort((i1,i2)=>{
        if (i1.semanticScore === null && i2.semanticScore === null) {
          return 0;
        }
        if (i1.semanticScore ?? 0 > (i2.semanticScore ?? 0)) return 1;
        if (i2.semanticScore ?? 0 > (i1.semanticScore ?? 0)) return -1;
        return 0
      })
      return sorted;
    } else {
      return [];
    }
  })


  itemName(item: { name: string; translations: Record<string, string> }): string { return this.i18n.name(item); }

  async submitSearch(event: Event): Promise<void> {
    event.preventDefault();
    await this.search.search(this.searchQuery(), {
      documentTypeUuid: this.selectedType() || undefined,
      categoryUuid: this.selectedCategory() || undefined,
      issuerUuid: this.selectedIssuer() || undefined,
      tagUuids: this.selectedTag() ? [this.selectedTag()] : undefined
    });
  }

  openDocument(event: Event, uuid: string): void {
    event.preventDefault();
    if (!this.canLeaveMetadata()) return;
    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.drawerTab.set('preview');
    this.drawerDocumentSnapshot.set(this.findDocument(uuid));
    this.drawerDocumentUuid.set(uuid);
  }

  openMetadata(event: Event, uuid: string): void {
    event.preventDefault();
    if (this.drawerDocumentUuid() === uuid && this.drawerTab() === 'metadata') return;
    if (!this.canLeaveMetadata()) return;
    this.metadataClosePrompt.set(false);
    this.metadataDirty.set(false);
    this.drawerTab.set('metadata');
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
    await this.search.search(this.searchQuery(), {
      documentTypeUuid: this.selectedType() || undefined,
      categoryUuid: this.selectedCategory() || undefined,
      issuerUuid: this.selectedIssuer() || undefined,
      tagUuids: this.selectedTag() ? [this.selectedTag()] : undefined
    });
  }

  private findDocument(uuid: string): Document | null {
    return this.search.result()?.items.find((item) => item.document.uuid === uuid)?.document ?? null;
  }
}
