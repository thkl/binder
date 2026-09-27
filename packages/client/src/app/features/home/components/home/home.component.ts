
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
  readonly selectedIssuer = signal('');

  searchResult = computed(()=>{
    const result = this.search.result();
    if (result) {
      const sorted = result.items.sort((i1,i2)=>{
        if (i1.semanticScore === null && i2.semanticScore === null) {
          return 0;
        }
        if (i1.semanticScore ?? 0 > (i2.semanticScore ?? 0)) return -1;
        if (i2.semanticScore ?? 0 > (i1.semanticScore ?? 0)) return 1;
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
    this.viewerDocumentUuid.set(uuid);
  }

  closeDocumentViewer(): void {
    this.viewerDocumentUuid.set(null);
  }
}
