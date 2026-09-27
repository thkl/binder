import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { CreateIssuerInput, Document, DocumentMetadata, DocumentTitleSuggestion, Issuer, UpdateIssuerInput } from '@binder/common';
import { MetadataService } from '../../services/metadata.service';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';

@Component({
  selector: 'binder-document-metadata-editor',
  standalone: true,
  imports: [DecimalPipe, TranslatePipe],
  templateUrl: './document-metadata-editor.component.html',
  styleUrl: './document-metadata-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentMetadataEditorComponent {
  readonly documentUuid = input.required<string>();
  readonly suggestion = input<DocumentTitleSuggestion | null>(null);
  readonly documentData = input<Document | null>(null);

  readonly suggestionAccepted = output<string>();
  readonly suggestionTitleAccepted = output<string>();
  readonly suggestionDismissed = output<void>();
  readonly manuallySaved = output<void>();
  readonly dirtyChange = output<boolean>();
  
  readonly metadata = inject(MetadataService);
  readonly i18n = inject(I18nService);
  readonly documentTypeUuid = signal('');
  readonly categoryUuid = signal('');
  readonly issuerUuid = signal('');
  readonly selectedTags = signal<Set<string>>(new Set());
  readonly loaded = signal(false);
  readonly saved = signal(false);
  readonly dirty = signal(false);
  private readonly metadataDirty = signal(false);
  private readonly issuerFormDirty = signal(false);
  readonly customValues = signal<Record<string, unknown>>({});
  readonly newTagName = signal('');
  readonly tagSearch = signal('');
  readonly acceptedSuggestionFields = signal<Set<string>>(new Set());
  private readonly inputSuggestion = signal<DocumentTitleSuggestion | null>(null);
  private readonly serverSuggestion = signal<DocumentTitleSuggestion | null>(null);
  readonly activeSuggestion = computed(() => this.inputSuggestion() ?? this.serverSuggestion());
  readonly showIssuerForm = signal(false);
  readonly editingIssuerUuid = signal<string | null>(null);
  readonly issuerName = signal('');
  readonly issuerAddress = signal('');
  readonly issuerZipCode = signal('');
  readonly issuerCity = signal('');
  readonly issuerCountry = signal('');
  readonly issuerCustomJson = signal('{}');
  readonly issuerError = signal<string | null>(null);
  readonly previewTab = signal<'thumbnail' | 'text'>('thumbnail');
  readonly extractedText = signal<string | null>(null);
  readonly extractedTextLoading = signal(false);
  readonly extractedTextLoaded = signal(false);
  readonly extractedTextError = signal<string | null>(null);
  readonly filteredTags = computed(() => {
    const search = this.tagSearch().trim().toLowerCase();
    return (this.metadata.vocabulary()?.tags ?? []).filter((tag) => !search || tag.name.toLowerCase().includes(search));
  });

  private readonly documentInputEffect = effect(() => {
    const uuid = this.documentUuid();
    if (uuid) {
      this.serverSuggestion.set(null);
      this.previewTab.set('thumbnail');
      this.extractedText.set(null);
      this.extractedTextLoaded.set(false);
      this.extractedTextError.set(null);
      void this.load(uuid);
    }
  });

  private readonly suggestionInputEffect = effect(() => {
    this.inputSuggestion.set(this.suggestion());
    this.acceptedSuggestionFields.set(new Set());
  });

  async load(uuid = this.documentUuid()): Promise<void> {
    this.loaded.set(false);
    const [, current] = await Promise.all([
      this.metadata.loadVocabulary(),
      this.metadata.getDocumentMetadata(uuid)

    ]);
    if (uuid !== this.documentUuid()) return;
    if (current) this.applyMetadata(current);
    else this.markClean();
    this.loaded.set(true);
  }

  toggleTag(uuid: string): void {
    this.selectedTags.update((selected) => {
      const next = new Set(selected);
      if (next.has(uuid)) next.delete(uuid); else next.add(uuid);
      return next;
    });
    this.markMetadataDirty();
  }

  isTagSelected(uuid: string): boolean { return this.selectedTags().has(uuid); }

  async save(): Promise<boolean> {
    const result = await this.metadata.setDocumentMetadata(this.documentUuid(), {
      issuerUuid: this.issuerUuid() || null,
      documentTypeUuid: this.documentTypeUuid() || null,
      categoryUuid: this.categoryUuid() || null,
      tagUuids: [...this.selectedTags()],
      custom: this.customValues()
    });
    if (result) {
      const persisted = await this.metadata.getDocumentMetadata(this.documentUuid());
      this.applyMetadata(persisted ?? result);
      this.saved.set(true);
      this.manuallySaved.emit();
      return true;
    }
    return false;
  }

  setDocumentTypeUuid(uuid: string): void {
    this.documentTypeUuid.set(uuid);
    this.markMetadataDirty();
  }

  setCategoryUuid(uuid: string): void {
    this.categoryUuid.set(uuid);
    this.markMetadataDirty();
  }

  setIssuerUuid(uuid: string): void {
    this.issuerUuid.set(uuid);
    this.markMetadataDirty();
  }

  markIssuerFormDirty(): void {
    this.issuerFormDirty.set(true);
    this.updateDirtyState();
  }

  acceptSuggestionField(field: string): void {
    const suggestion = this.activeSuggestion();
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
    if (field === 'title') this.suggestionTitleAccepted.emit(suggestion.suggestedTitle);
    this.markMetadataDirty();
  }

  async acceptAllSuggestion(): Promise<void> {
    const suggestion = this.activeSuggestion();
    if (!suggestion) return;
    for (const field of ['title', 'documentTypeUuid', 'categoryUuid', 'tagUuids', 'custom']) {
      if (!this.acceptedSuggestionFields().has(field)) this.acceptSuggestionField(field);
    }
    if (!await this.save()) return;
    this.inputSuggestion.set(null);
    this.serverSuggestion.set(null);
    this.suggestionAccepted.emit(suggestion.suggestedTitle);
  }

  async dismissSuggestion(): Promise<void> {
    if (await this.metadata.clearDocumentSuggestion(this.documentUuid()) === null) return;
    this.inputSuggestion.set(null);
    this.serverSuggestion.set(null);
    this.acceptedSuggestionFields.set(new Set());
    this.suggestionDismissed.emit();
  }

  async selectPreviewTab(tab: 'thumbnail' | 'text'): Promise<void> {
    this.previewTab.set(tab);
    if (tab === 'text' && !this.extractedTextLoaded() && !this.extractedTextLoading()) {
      this.extractedTextLoading.set(true);
      this.extractedTextError.set(null);
      const result = await this.metadata.getExtractedText(this.documentUuid());
      if (result) {
        this.extractedText.set(result.text);
        this.extractedTextLoaded.set(true);
      } else {
        this.extractedTextError.set(this.i18n.t('editor.textError'));
      }
      this.extractedTextLoading.set(false);
    }
  }

  isSuggestionAccepted(field: string): boolean { return this.acceptedSuggestionFields().has(field); }

  suggestedTypeName(uuid: string | null): string {
    const item = this.metadata.vocabulary()?.documentTypes.find((candidate) => candidate.uuid === uuid);
    return item ? this.i18n.name(item) : 'No suggestion';
  }

  suggestedCategoryName(uuid: string | null): string {
    const item = this.metadata.vocabulary()?.categories.find((candidate) => candidate.uuid === uuid);
    return item ? this.i18n.name(item) : 'No suggestion';
  }

  itemName(item: { name: string; translations: Record<string, string> }): string { return this.i18n.name(item); }

  suggestedCustomCount(): number {
    const suggestion = this.activeSuggestion();
    return suggestion ? Object.keys(suggestion.custom).length : 0;
  }

  private applyMetadata(current: DocumentMetadata): void {
    this.issuerUuid.set(current.issuer?.uuid ?? '');
    this.documentTypeUuid.set(current.documentType?.uuid ?? '');
    this.categoryUuid.set(current.category?.uuid ?? '');
    this.selectedTags.set(new Set(current.tags.map((tag) => tag.uuid)));
    this.customValues.set({ ...current.custom });
    this.serverSuggestion.set(current.suggestion);
    this.markClean();
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
      this.markMetadataDirty();
    }
  }

  customValue(key: string): unknown { return this.customValues()[key] ?? ''; }

  setCustomValue(key: string, value: unknown): void {
    this.customValues.update((current) => ({ ...current, [key]: value }));
    this.markMetadataDirty();
  }

  setTypedValue(key: string, type: string, value: string): void {
    this.setCustomValue(key, type === 'number' && value !== '' ? Number(value) : value);
  }

  setMultiValue(key: string, event: Event): void {
    this.setCustomValue(key, (event.target as HTMLInputElement).value.split(',').map((item) => item.trim()).filter(Boolean));
  }

  selectedIssuer(): Issuer | undefined {
    return this.metadata.issuers().find((issuer) => issuer.uuid === this.issuerUuid());
  }

  openIssuerForm(): void {
    const selected = this.selectedIssuer();
    this.editingIssuerUuid.set(selected?.uuid ?? null);
    this.issuerName.set(selected?.name ?? '');
    this.issuerAddress.set(selected?.address ?? '');
    this.issuerZipCode.set(selected?.zipCode ?? '');
    this.issuerCity.set(selected?.city ?? '');
    this.issuerCountry.set(selected?.country ?? '');
    this.issuerCustomJson.set(JSON.stringify(selected?.custom ?? {}, null, 2));
    this.issuerError.set(null);
    this.issuerFormDirty.set(false);
    this.updateDirtyState();
    this.showIssuerForm.set(true);
  }

  cancelIssuerForm(): void {
    this.issuerError.set(null);
    this.issuerFormDirty.set(false);
    this.updateDirtyState();
    this.showIssuerForm.set(false);
  }

  async saveIssuer(): Promise<void> {
    let custom: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(this.issuerCustomJson());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Issuer custom fields must be a JSON object');
      custom = parsed as Record<string, unknown>;
    } catch (error) {
      this.issuerError.set(error instanceof Error ? error.message : 'Custom issuer fields must be valid JSON');
      return;
    }

    const input: CreateIssuerInput = {
      name: this.issuerName().trim(),
      address: this.issuerAddress().trim() || null,
      zipCode: this.issuerZipCode().trim() || null,
      city: this.issuerCity().trim() || null,
      country: this.issuerCountry().trim() || null,
      custom
    };
    const editingUuid = this.editingIssuerUuid();
    const result = editingUuid
      ? await this.metadata.updateIssuer(editingUuid, input as UpdateIssuerInput)
      : await this.metadata.createIssuer(input);
    if (result) {
      this.issuerUuid.set(result.uuid);
      this.showIssuerForm.set(false);
      this.issuerFormDirty.set(false);
      this.markMetadataDirty();
      await this.save();
    }
  }

  private markMetadataDirty(): void {
    if (!this.loaded()) return;
    this.saved.set(false);
    this.metadataDirty.set(true);
    this.updateDirtyState();
  }

  private markClean(): void {
    this.saved.set(false);
    this.metadataDirty.set(false);
    this.issuerFormDirty.set(false);
    this.updateDirtyState();
  }

  private updateDirtyState(): void {
    const next = this.metadataDirty() || this.issuerFormDirty();
    if (next === this.dirty()) return;
    this.dirty.set(next);
    this.dirtyChange.emit(next);
  }
}
