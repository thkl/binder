import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CreateMetadataDefinition, CreateVocabularyItem, MetadataFieldType } from '@binder/common';
import { AuthService } from '../../../authentication/services/auth.service';
import { MetadataService } from '../../services/metadata.service';

type VocabularyKind = 'documentTypes' | 'categories' | 'tags';

@Component({
  selector: 'binder-metadata',
  standalone: true,
  templateUrl: './metadata.component.html',
  styleUrl: './metadata.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MetadataComponent implements OnInit {
  readonly metadata = inject(MetadataService);
  readonly auth = inject(AuthService);
  readonly activeKind = signal<VocabularyKind>('documentTypes');
  readonly name = signal('');
  readonly description = signal('');
  readonly systemScope = signal(false);
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
  }

  selectKind(kind: VocabularyKind): void {
    this.activeKind.set(kind);
    this.showCreate.set(false);
  }

  kindLabel(kind: VocabularyKind): string {
    return kind === 'documentTypes' ? 'Document types' : kind === 'categories' ? 'Categories' : 'Tags';
  }

  async create(): Promise<void> {
    const name = this.name().trim();
    if (!name) return;
    const kind = this.activeKind() === 'documentTypes' ? 'document-types'
      : this.activeKind() === 'categories' ? 'categories' : 'tags';
    const input: CreateVocabularyItem = {
      name,
      description: this.description().trim() || undefined,
      scope: this.systemScope() && this.auth.user()?.isAdmin ? 'system' : 'personal'
    };
    if (await this.metadata.create(kind, input)) {
      this.name.set('');
      this.description.set('');
      this.systemScope.set(false);
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
