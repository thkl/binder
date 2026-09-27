
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SearchService } from '../../services/search.service';
import { DocumentViewerComponent } from '../../../../common/components/document-viewer/document-viewer.component';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';

@Component({
  selector: 'binder-home',
  standalone: true,
  imports: [CommonModule, DocumentViewerComponent, TranslatePipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomeComponent {
  readonly search = inject(SearchService);
  readonly i18n = inject(I18nService);
  readonly searchQuery = signal('');
  readonly viewerDocumentUuid = signal<string | null>(null);
  readonly viewerDocumentTitle = computed(() => {
    const uuid = this.viewerDocumentUuid();
    return this.search.result()?.items.find((item) => item.document.uuid === uuid)?.document.title
      || this.search.result()?.items.find((item) => item.document.uuid === uuid)?.document.originalFilename
      || 'Document';
  });
  readonly selectedType = signal('');
  readonly selectedCategory = signal('');
  readonly selectedTag = signal('');

  itemName(item: { name: string; translations: Record<string, string> }): string { return this.i18n.name(item); }

  async submitSearch(event: Event): Promise<void> {
    event.preventDefault();
    await this.search.search(this.searchQuery(), {
      documentTypeUuid: this.selectedType() || undefined,
      categoryUuid: this.selectedCategory() || undefined,
      tagUuids: this.selectedTag() ? [this.selectedTag()] : undefined
    });
  }

  openDocument(event: Event, uuid: string): void {
    event.preventDefault();
    this.viewerDocumentUuid.set(uuid);
  }

  closeDocumentViewer(): void {
    this.viewerDocumentUuid.set(null);
  }
}
