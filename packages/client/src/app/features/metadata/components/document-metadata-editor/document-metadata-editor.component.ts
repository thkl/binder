import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
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
  readonly customValues = signal<Record<string, unknown>>({});
  readonly newTagName = signal('');
  readonly tagSearch = signal('');
  readonly filteredTags = computed(() => {
    const search = this.tagSearch().trim().toLowerCase();
    return (this.metadata.vocabulary()?.tags ?? []).filter((tag) => !search || tag.name.toLowerCase().includes(search));
  });

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
      this.customValues.set({ ...current.custom });
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
      tagUuids: [...this.selectedTags()],
      custom: this.customValues()
    });
    if (result) this.saved.set(true);
  }

  async addTag(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.newTagName().trim();
    if (!name) return;
    if (await this.metadata.create('tags', { name, scope: 'personal' })) {
      const tag = this.metadata.vocabulary()?.tags.find((item) => item.name.toLowerCase() === name.toLowerCase());
      if (tag) this.selectedTags.update((selected) => new Set(selected).add(tag.uuid));
      this.newTagName.set('');
      this.tagSearch.set('');
    }
  }

  customValue(key: string): unknown { return this.customValues()[key] ?? ''; }

  setCustomValue(key: string, value: unknown): void {
    this.customValues.update((current) => ({ ...current, [key]: value }));
    this.saved.set(false);
  }

  setTypedValue(key: string, type: string, value: string): void {
    this.setCustomValue(key, type === 'number' && value !== '' ? Number(value) : value);
  }

  setMultiValue(key: string, event: Event): void {
    this.setCustomValue(key, (event.target as HTMLInputElement).value.split(',').map((item) => item.trim()).filter(Boolean));
  }
}
