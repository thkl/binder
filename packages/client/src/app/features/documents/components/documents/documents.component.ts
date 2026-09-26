import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentsService } from '../../services/documents.service';

type DocumentViewMode = 'list' | 'details' | 'small-icons' | 'large-icons';

@Component({
  selector: 'binder-documents',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './documents.component.html',
  styleUrl: './documents.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentsComponent implements OnInit {
  readonly documents = inject(DocumentsService);
  readonly thumbnailFailed = signal<Record<string, boolean>>({});
  readonly viewMode = signal<DocumentViewMode>(this.readViewMode());

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

  thumbnailUrl(uuid: string): string {
    return `/api/v1/documents/${uuid}/thumbnail`;
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

  private readViewMode(): DocumentViewMode {
    const stored = localStorage.getItem('binder.documents.view-mode');
    return stored === 'details' || stored === 'small-icons' || stored === 'large-icons'
      ? stored
      : 'list';
  }
}
