import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { MetadataService } from '../../services/metadata.service';

@Component({
  selector: 'binder-document-metadata-editor',
  standalone: true,
  templateUrl: './document-metadata-editor.component.html',
  styleUrl: './document-metadata-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentMetadataEditorComponent implements OnChanges {
  @Input({ required: true }) documentUuid = '';

  readonly metadata = inject(MetadataService);
  readonly documentTypeUuid = signal('');
  readonly categoryUuid = signal('');
  readonly selectedTags = signal<Set<string>>(new Set());
  readonly loaded = signal(false);
  readonly saved = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['documentUuid'] && this.documentUuid) void this.load();
  }

  async load(): Promise<void> {
    this.loaded.set(false);
    const [vocabulary, current] = await Promise.all([
      this.metadata.vocabulary() ? Promise.resolve(this.metadata.vocabulary()) : this.metadata.loadVocabulary(),
      this.metadata.getDocumentMetadata(this.documentUuid)
    ]);
    if (vocabulary && current) {
      this.documentTypeUuid.set(current.documentType?.uuid ?? '');
      this.categoryUuid.set(current.category?.uuid ?? '');
      this.selectedTags.set(new Set(current.tags.map((tag) => tag.uuid)));
    }
    this.loaded.set(true);
  }

  toggleTag(uuid: string): void {
    this.selectedTags.update((selected) => {
      const next = new Set(selected);
      if (next.has(uuid)) next.delete(uuid); else next.add(uuid);
      return next;
    });
    this.saved.set(false);
  }

  isTagSelected(uuid: string): boolean { return this.selectedTags().has(uuid); }

  async save(): Promise<void> {
    const result = await this.metadata.setDocumentMetadata(this.documentUuid, {
      documentTypeUuid: this.documentTypeUuid() || null,
      categoryUuid: this.categoryUuid() || null,
      tagUuids: [...this.selectedTags()]
    });
    if (result) this.saved.set(true);
  }
}
