import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CreateMetadataDefinition, CreateVocabularyItem, MetadataFieldType, UpdateVocabularyItem, VocabularyItem } from '@binder/common';
import { AuthService } from '../../../authentication/services/auth.service';
import { MetadataService } from '../../services/metadata.service';
import { FoldersService } from '../../../documents/services/folders.service';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';

type VocabularyKind = 'documentTypes' | 'categories' | 'tags';

@Component({
  selector: 'binder-metadata',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './metadata.component.html',
  styleUrl: './metadata.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
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
  readonly editingFolderUuid = signal('');
  readonly showCreate = signal(false);
  readonly definitionKey = signal('');
  readonly definitionLabel = signal('');
  readonly definitionType = signal<MetadataFieldType>('text');
  readonly definitionOptions = signal('');
  readonly definitionMandatory = signal(false);

  readonly activeItems = computed(() => {
    const vocabulary = this.metadata.vocabulary();
    if (!vocabulary) return [];
    return vocabulary[this.activeKind()];
  });

  ngOnInit(): void {
    void this.metadata.loadVocabulary();
    void this.folders.listAll();
  }

  selectKind(kind: VocabularyKind): void {
    this.activeKind.set(kind);
    this.showCreate.set(false);
    this.cancelEdit();
  }

  kindLabel(kind: VocabularyKind): string {
    return kind === 'documentTypes' ? this.i18n.t('metadata.types') : kind === 'categories' ? this.i18n.t('metadata.categories') : this.i18n.t('metadata.tags');
  }

  itemName(item: { name: string; translations: Record<string, string> }): string { return this.i18n.name(item); }

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
    if (this.activeKind() === 'tags' || item.scope === 'system') return;
    this.editingUuid.set(item.uuid);
    this.editingFolderUuid.set(item.folderUuid ?? '');
  }

  cancelEdit(): void {
    this.editingUuid.set(null);
    this.editingFolderUuid.set('');
  }

  async saveEdit(item: VocabularyItem): Promise<void> {
    const input: UpdateVocabularyItem = { folderUuid: this.editingFolderUuid() || null };
    if (await this.metadata.updateVocabulary(this.vocabularyPath(), item.uuid, input)) this.cancelEdit();
  }

  vocabularyPath(): 'document-types' | 'categories' | 'tags' {
    const kind = this.activeKind();
    if (kind === 'documentTypes') return 'document-types';
    if (kind === 'categories') return 'categories';
    return 'tags';
  }

  async create(): Promise<void> {
    const name = this.name().trim();
    if (!name) return;
    const kind = this.activeKind() === 'documentTypes' ? 'document-types'
      : this.activeKind() === 'categories' ? 'categories' : 'tags';
    const input: CreateVocabularyItem = {
      name,
      description: this.description().trim() || undefined,
      translations: {
        ...(this.translationEn().trim() ? { en: this.translationEn().trim() } : {}),
        ...(this.translationDe().trim() ? { de: this.translationDe().trim() } : {})
      },
      scope: this.systemScope() && this.auth.user()?.isAdmin ? 'system' : 'personal',
      folderUuid: this.activeKind() === 'tags' || this.systemScope() ? null : (this.folderUuid() || null)
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
        ? this.definitionOptions().split(',').map((item) => item.trim()).filter(Boolean)
        : undefined,
      mandatory: this.definitionMandatory(),
      unique: false,
      scope: 'personal'
    };
    if (await this.metadata.createDefinition(input)) {
      this.definitionKey.set('');
      this.definitionLabel.set('');
      this.definitionOptions.set('');
      this.definitionMandatory.set(false);
    }
  }
}
