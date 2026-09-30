import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  CreateMetadataDefinition,
  CreateVocabularyItem,
  MetadataFieldType,
  UpdateVocabularyItem,
  VocabularyItem,
} from '@binder/common';
import { AuthService } from '../../../authentication/services/auth.service';
import { MetadataService } from '../../services/metadata.service';
import { FoldersService } from '../../../documents/services/folders.service';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';

type VocabularyKind = 'documentTypes' | 'categories' | 'tags';
type Scopes = 'system' | 'personal';

@Component({
  selector: 'binder-metadata',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './metadata.component.html',
  styleUrl: './metadata.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetadataComponent implements OnInit {
  readonly metadata = inject(MetadataService);
  readonly folders = inject(FoldersService);
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);
  readonly activeKind = signal<VocabularyKind>('documentTypes');
  readonly name = signal('');
  readonly description = signal('');
  readonly translationEn = signal('');
  readonly translationDe = signal('');
  readonly systemScope = signal(false);
  readonly folderUuid = signal('');
  readonly editingUuid = signal<string | null>(null);
  readonly editingName = signal('');
  readonly editingDescription = signal('');
  readonly editingTranslationEn = signal('');
  readonly editingTranslationDe = signal('');
  readonly editingTranslations = signal<Record<string, string>>({});
  readonly editingFolderUuid = signal('');
  readonly showCreate = signal(false);
  readonly definitionKey = signal('');
  readonly definitionLabel = signal('');
  readonly definitionType = signal<MetadataFieldType>('text');
  readonly definitionOptions = signal('');
  readonly definitionMandatory = signal(false);
  readonly currentScope = signal<Scopes>('system');

  readonly activeItems = computed(() => {
    const scope = this.currentScope();
    const vocabulary = this.metadata.vocabulary();
    if (this.activeKind() !== 'tags') {
      return vocabulary ? vocabulary[this.activeKind()].filter((item) => item.scope === scope) : [];
    } else {
      if (!vocabulary) return [];
      return vocabulary[this.activeKind()];
    }
  });

  ngOnInit(): void {
    void this.metadata.loadVocabulary();
    void this.folders.listAll();

    if (!this.auth.user()?.isAdmin) {
      this.currentScope.set('personal');
    }
  }

  selectKind(kind: VocabularyKind): void {
    this.activeKind.set(kind);
    this.showCreate.set(false);
    this.cancelEdit();
  }

  switchScope(scope: Scopes): void {
    this.currentScope.set(scope);
    this.systemScope.set(scope === 'system');
  }

  kindLabel(kind: VocabularyKind): string {
    return kind === 'documentTypes'
      ? this.i18n.t('metadata.types')
      : kind === 'categories'
        ? this.i18n.t('metadata.categories')
        : this.i18n.t('metadata.tags');
  }

  itemName(item: { name: string; translations: Record<string, string> }): string {
    return this.i18n.name(item);
  }

  folderPath(uuid: string): string {
    const byUuid = new Map(this.folders.allFolders().map((folder) => [folder.uuid, folder]));
    const parts: string[] = [];
    const visited = new Set<string>();
    let current = byUuid.get(uuid);
    while (current && !visited.has(current.uuid)) {
      visited.add(current.uuid);
      parts.unshift(current.name);
      current = current.parentUuid ? byUuid.get(current.parentUuid) : undefined;
    }
    return parts.join(' / ');
  }

  startEdit(item: VocabularyItem): void {
    if (!this.canEdit(item)) return;
    this.editingUuid.set(item.uuid);
    this.editingName.set(item.name);
    this.editingDescription.set(item.description ?? '');
    this.editingTranslationEn.set(item.translations['en'] ?? '');
    this.editingTranslationDe.set(item.translations['de'] ?? '');
    this.editingTranslations.set({ ...item.translations });
    this.editingFolderUuid.set(item.folderUuid ?? '');
  }

  cancelEdit(): void {
    this.editingUuid.set(null);
    this.editingName.set('');
    this.editingDescription.set('');
    this.editingTranslationEn.set('');
    this.editingTranslationDe.set('');
    this.editingTranslations.set({});
    this.editingFolderUuid.set('');
  }

  async saveEdit(item: VocabularyItem): Promise<void> {
    const name = this.editingName().trim();
    if (!name) return;

    const translations = { ...this.editingTranslations() };
    this.setTranslation(translations, 'en', this.editingTranslationEn());
    this.setTranslation(translations, 'de', this.editingTranslationDe());

    const input: UpdateVocabularyItem = {
      name,
      description: this.editingDescription().trim() || null,
      translations,
      ...(this.activeKind() === 'tags' || item.scope === 'system'
        ? {}
        : { folderUuid: this.editingFolderUuid() || null }),
    };
    if (await this.metadata.updateVocabulary(this.vocabularyPath(), item.uuid, input))
      this.cancelEdit();
  }

  canEdit(item: VocabularyItem): boolean {
    return (
      this.activeKind() !== 'tags' &&
      (item.scope === 'personal' || this.auth.user()?.isAdmin === true)
    );
  }

  canClone(item: VocabularyItem): boolean {
    return this.activeKind() !== 'tags' && item.scope === 'system';
  }

  canDelete(item: VocabularyItem): boolean {
    return (
      this.activeKind() !== 'tags' &&
      (item.scope === 'personal' || this.auth.user()?.isAdmin === true)
    );
  }

  async cloneItem(item: VocabularyItem): Promise<void> {
    if (!this.canClone(item)) return;

    const copy = await this.metadata.cloneVocabulary(
      this.vocabularyPath() as 'document-types' | 'categories',
      item.uuid,
    );
    if (copy) this.startEdit(copy);
  }

  async deleteItem(item: VocabularyItem): Promise<void> {
    if (!this.canDelete(item)) return;
    const confirmed = window.confirm(this.i18n.t('metadata.deleteConfirm'));
    if (!confirmed) return;

    await this.metadata.deleteVocabulary(
      this.vocabularyPath() as 'document-types' | 'categories',
      item.uuid,
    );
  }

  vocabularyPath(): 'document-types' | 'categories' | 'tags' {
    const kind = this.activeKind();
    if (kind === 'documentTypes') return 'document-types';
    if (kind === 'categories') return 'categories';
    return 'tags';
  }

  private setTranslation(
    translations: Record<string, string>,
    language: 'en' | 'de',
    value: string,
  ): void {
    const trimmed = value.trim();
    if (trimmed) {
      translations[language] = trimmed;
    } else {
      delete translations[language];
    }
  }

  async create(): Promise<void> {
    const name = this.name().trim();
    if (!name) return;
    const kind =
      this.activeKind() === 'documentTypes'
        ? 'document-types'
        : this.activeKind() === 'categories'
          ? 'categories'
          : 'tags';
    const input: CreateVocabularyItem = {
      name,
      description: this.description().trim() || undefined,
      translations: {
        ...(this.translationEn().trim() ? { en: this.translationEn().trim() } : {}),
        ...(this.translationDe().trim() ? { de: this.translationDe().trim() } : {}),
      },
      scope: this.systemScope() && this.auth.user()?.isAdmin ? 'system' : 'personal',
      folderUuid:
        this.activeKind() === 'tags' || this.systemScope() ? null : this.folderUuid() || null,
    };
    if (await this.metadata.create(kind, input)) {
      this.name.set('');
      this.description.set('');
      this.translationEn.set('');
      this.translationDe.set('');
      this.systemScope.set(false);
      this.folderUuid.set('');
      this.showCreate.set(false);
    }
  }

  async createDefinition(): Promise<void> {
    const key = this.definitionKey().trim();
    const label = this.definitionLabel().trim();
    if (!key || !label) return;
    const input: CreateMetadataDefinition = {
      key,
      label,
      type: this.definitionType(),
      options: ['select', 'multi-select'].includes(this.definitionType())
        ? this.definitionOptions()
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
      mandatory: this.definitionMandatory(),
      unique: false,
      scope: 'personal',
    };
    if (await this.metadata.createDefinition(input)) {
      this.definitionKey.set('');
      this.definitionLabel.set('');
      this.definitionOptions.set('');
      this.definitionMandatory.set(false);
    }
  }
}
