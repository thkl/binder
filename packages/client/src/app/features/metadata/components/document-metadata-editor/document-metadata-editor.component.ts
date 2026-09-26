import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { DocumentTitleSuggestion } from '@binder/common';
import { MetadataService } from '../../services/metadata.service';

@Component({
  selector: 'binder-document-metadata-editor',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './document-metadata-editor.component.html',
  styleUrl: './document-metadata-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentMetadataEditorComponent implements OnChanges {
  @Input({ required: true }) documentUuid = '';
  @Input() suggestion: DocumentTitleSuggestion | null = null;
  @Output() suggestionAccepted = new EventEmitter<void>();

  readonly metadata = inject(MetadataService);
  readonly documentTypeUuid = signal('');
  readonly categoryUuid = signal('');
  readonly selectedTags = signal<Set<string>>(new Set());
  readonly loaded = signal(false);
  readonly saved = signal(false);
  readonly customValues = signal<Record<string, unknown>>({});
  readonly newTagName = signal('');
  readonly tagSearch = signal('');
  readonly acceptedSuggestionFields = signal<Set<string>>(new Set());
  readonly filteredTags = computed(() => {
    const search = this.tagSearch().trim().toLowerCase();
    return (this.metadata.vocabulary()?.tags ?? []).filter((tag) => !search || tag.name.toLowerCase().includes(search));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['documentUuid'] && this.documentUuid) void this.load();
    if (changes['suggestion']) this.acceptedSuggestionFields.set(new Set());
  }

  async load(): Promise<void> {
    this.loaded.set(false);
    const [, current] = await Promise.all([
      this.metadata.loadVocabulary(),
      this.metadata.getDocumentMetadata(this.documentUuid)
    ]);
    if (current) this.applyMetadata(current);
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
    if (result) {
      const persisted = await this.metadata.getDocumentMetadata(this.documentUuid);
      this.applyMetadata(persisted ?? result);
      this.saved.set(true);
    }
  }

  acceptSuggestionField(field: string): void {
    const suggestion = this.suggestion;
    if (!suggestion) return;
    this.acceptedSuggestionFields.update((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field); else next.add(field);
      return next;
    });
    if (field === 'documentTypeUuid') this.documentTypeUuid.set(suggestion.documentTypeUuid ?? '');
    if (field === 'categoryUuid') this.categoryUuid.set(suggestion.categoryUuid ?? '');
    if (field === 'tagUuids') this.selectedTags.set(new Set(suggestion.tagUuids));
    if (field === 'custom') this.customValues.update((current) => ({ ...current, ...suggestion.custom }));
    this.saved.set(false);
  }

  async acceptAllSuggestion(): Promise<void> {
    if (!this.suggestion) return;
    for (const field of ['documentTypeUuid', 'categoryUuid', 'tagUuids', 'custom']) {
      if (!this.acceptedSuggestionFields().has(field)) this.acceptSuggestionField(field);
    }
    await this.save();
    this.suggestionAccepted.emit();
  }

  isSuggestionAccepted(field: string): boolean { return this.acceptedSuggestionFields().has(field); }

  suggestedTypeName(uuid: string | null): string {
    return this.metadata.vocabulary()?.documentTypes.find((item) => item.uuid === uuid)?.name ?? 'No suggestion';
  }

  suggestedCategoryName(uuid: string | null): string {
    return this.metadata.vocabulary()?.categories.find((item) => item.uuid === uuid)?.name ?? 'No suggestion';
  }

  suggestedCustomCount(): number { return this.suggestion ? Object.keys(this.suggestion.custom).length : 0; }

  private applyMetadata(current: { documentType: { uuid: string } | null; category: { uuid: string } | null; tags: { uuid: string }[]; custom: Record<string, unknown> }): void {
    this.documentTypeUuid.set(current.documentType?.uuid ?? '');
    this.categoryUuid.set(current.category?.uuid ?? '');
    this.selectedTags.set(new Set(current.tags.map((tag) => tag.uuid)));
    this.customValues.set({ ...current.custom });
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
