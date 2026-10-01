import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import type {
  BulkMetadataApplyResponse,
  BulkMetadataInput,
  BulkMetadataPolicy,
  BulkMetadataPreviewResponse,
  FolderNode,
  Issuer,
  MetadataDefinition,
  VocabularyItem,
} from '@binder/common';
import { BulkMetadataInputSchema } from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { DocumentsService } from '../../services/documents.service';

@Component({
  selector: 'binder-bulk-metadata-dialog',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './bulk-metadata-dialog.component.html',
  styleUrl: './bulk-metadata-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BulkMetadataDialogComponent {
  readonly documentUuids = input.required<string[]>();
  readonly documentTypes = input<VocabularyItem[]>([]);
  readonly categories = input<VocabularyItem[]>([]);
  readonly tags = input<VocabularyItem[]>([]);
  readonly issuers = input<Issuer[]>([]);
  readonly folders = input<FolderNode[]>([]);
  readonly definitions = input<MetadataDefinition[]>([]);
  readonly closed = output<void>();
  readonly applied = output<BulkMetadataApplyResponse>();

  readonly policy = signal<BulkMetadataPolicy>('fill-empty');
  readonly enabledFields = signal<Set<string>>(new Set());
  readonly documentTypeUuid = signal('');
  readonly categoryUuid = signal('');
  readonly issuerUuid = signal('');
  readonly folderUuid = signal('');
  readonly tagUuids = signal<Set<string>>(new Set());
  readonly customValues = signal<Record<string, string>>({});
  readonly preview = signal<BulkMetadataPreviewResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private readonly documents = inject(DocumentsService);
  readonly i18n = inject(I18nService);

  toggleField(field: string): void {
    this.enabledFields.update((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
    this.preview.set(null);
  }

  isEnabled(field: string): boolean {
    return this.enabledFields().has(field);
  }

  selectValue(field: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (field === 'documentTypeUuid') this.documentTypeUuid.set(value);
    if (field === 'categoryUuid') this.categoryUuid.set(value);
    if (field === 'issuerUuid') this.issuerUuid.set(value);
    if (field === 'folderUuid') this.folderUuid.set(value);
    this.preview.set(null);
  }

  setPolicy(event: Event): void {
    this.policy.set((event.target as HTMLSelectElement).value as BulkMetadataPolicy);
    this.preview.set(null);
  }

  toggleTag(tagUuid: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.tagUuids.update((current) => {
      const next = new Set(current);
      if (checked) next.add(tagUuid);
      else next.delete(tagUuid);
      return next;
    });
    this.preview.set(null);
  }

  setCustomValue(key: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.customValues.update((current) => ({ ...current, [key]: value }));
    this.preview.set(null);
  }

  conflictingFieldLabels(fields: string[]): string {
    return fields.map((field) => this.fieldLabel(field)).join(', ');
  }

  async reviewOrApply(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const input = this.buildInput();
      if (!this.preview()) {
        const preview = await this.documents.previewBulkMetadata(input);
        if (!preview) {
          this.error.set(this.documents.error());
          return;
        }
        this.preview.set(preview);
        return;
      }

      const preview = this.preview();
      if (!preview) return;
      if (
        this.policy() === 'replace-selected' &&
        preview.conflicts > 0 &&
        !window.confirm(this.i18n.t('documents.bulkMetadataOverwriteConfirm'))
      ) {
        return;
      }

      const result = await this.documents.applyBulkMetadata(input);
      if (!result) {
        this.error.set(this.documents.error());
        return;
      }
      this.applied.emit(result);
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'The bulk update could not be prepared.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private buildInput(): BulkMetadataInput {
    const metadata: Record<string, unknown> = {};
    if (this.isEnabled('documentTypeUuid'))
      metadata['documentTypeUuid'] = this.documentTypeUuid() || null;
    if (this.isEnabled('categoryUuid')) metadata['categoryUuid'] = this.categoryUuid() || null;
    if (this.isEnabled('issuerUuid')) metadata['issuerUuid'] = this.issuerUuid() || null;
    if (this.isEnabled('tagUuids')) metadata['tagUuids'] = [...this.tagUuids()];

    const custom: Record<string, unknown> = {};
    for (const definition of this.definitions()) {
      if (!this.isEnabled(`custom.${definition.key}`)) continue;
      custom[definition.key] = this.parseCustomValue(
        definition,
        this.customValues()[definition.key] ?? '',
      );
    }
    if (Object.keys(custom).length > 0) metadata['custom'] = custom;

    const input = {
      documentUuids: this.documentUuids(),
      policy: this.policy(),
      metadata,
      ...(this.isEnabled('folders')
        ? { folderUuids: this.folderUuid() ? [this.folderUuid()] : [] }
        : {}),
    };
    return BulkMetadataInputSchema.parse(input);
  }

  private parseCustomValue(definition: MetadataDefinition, value: string): unknown {
    if (definition.type === 'number') return value.trim() === '' ? null : Number(value);
    if (definition.type === 'boolean') return value === 'true';
    if (definition.type === 'multi-select') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return value;
  }

  private fieldLabel(field: string): string {
    const labels: Record<string, string> = {
      documentTypeUuid: this.i18n.t('documents.type'),
      categoryUuid: this.i18n.t('documents.category'),
      issuerUuid: this.i18n.t('documents.issuer'),
      tagUuids: this.i18n.t('documents.tags'),
      folders: this.i18n.t('documents.folder'),
    };
    if (field.startsWith('custom.')) {
      return `${this.i18n.t('documents.customMetadata')}: ${field.slice('custom.'.length)}`;
    }
    return labels[field] ?? field;
  }
}
