import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CreateIssuerInput, Issuer, UpdateIssuerInput } from '@binder/common';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';
import { FoldersService } from '../../../documents/services/folders.service';
import { MetadataService } from '../../../metadata/services/metadata.service';

@Component({
  selector: 'binder-issuer-manager',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './issuer-manager.component.html',
  styleUrl: './issuer-manager.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssuerManagerComponent implements OnInit {
  readonly metadata = inject(MetadataService);
  readonly folders = inject(FoldersService);
  readonly search = signal('');
  readonly loading = signal(true);
  readonly editingUuid = signal<string | null>(null);
  readonly formOpen = signal(false);
  readonly formError = signal<string | null>(null);
  readonly saved = signal(false);
  readonly name = signal('');
  readonly address = signal('');
  readonly zipCode = signal('');
  readonly city = signal('');
  readonly country = signal('');
  readonly folderUuid = signal('');
  readonly customJson = signal('{}');

  readonly sortedFolders = computed(() =>
    [...this.folders.allFolders()].sort((left, right) =>
      this.folderPath(left.uuid).localeCompare(this.folderPath(right.uuid), undefined, {
        sensitivity: 'base',
        numeric: true,
      }),
    ),
  );

  readonly visibleIssuers = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return [...this.metadata.issuers()]
      .filter(
        (issuer) =>
          !query ||
          [issuer.name, issuer.address, issuer.zipCode, issuer.city, issuer.country]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(query)),
      )
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
      );
  });

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    await Promise.all([this.metadata.loadIssuers(), this.folders.listAll()]);
    this.loading.set(false);
  }

  startCreate(): void {
    this.editingUuid.set(null);
    this.name.set('');
    this.address.set('');
    this.zipCode.set('');
    this.city.set('');
    this.country.set('');
    this.folderUuid.set('');
    this.customJson.set('{}');
    this.formError.set(null);
    this.saved.set(false);
    this.formOpen.set(true);
  }

  edit(issuer: Issuer): void {
    this.editingUuid.set(issuer.uuid);
    this.name.set(issuer.name);
    this.address.set(issuer.address ?? '');
    this.zipCode.set(issuer.zipCode ?? '');
    this.city.set(issuer.city ?? '');
    this.country.set(issuer.country ?? '');
    this.folderUuid.set(issuer.folderUuid ?? '');
    this.customJson.set(JSON.stringify(issuer.custom ?? {}, null, 2));
    this.formError.set(null);
    this.saved.set(false);
    this.formOpen.set(true);
  }

  cancel(): void {
    this.formOpen.set(false);
    this.formError.set(null);
  }

  async save(): Promise<void> {
    let custom: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(this.customJson());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Issuer custom fields must be a JSON object.');
      }
      custom = parsed as Record<string, unknown>;
    } catch (error) {
      this.formError.set(
        error instanceof Error ? error.message : 'Issuer custom fields must be valid JSON.',
      );
      return;
    }

    const input: CreateIssuerInput = {
      name: this.name().trim(),
      address: this.address().trim() || null,
      zipCode: this.zipCode().trim() || null,
      city: this.city().trim() || null,
      country: this.country().trim() || null,
      folderUuid: this.folderUuid() || null,
      custom,
    };
    if (!input.name) {
      this.formError.set('Issuer name is required.');
      return;
    }

    this.formError.set(null);
    const uuid = this.editingUuid();
    const result = uuid
      ? await this.metadata.updateIssuer(uuid, input as UpdateIssuerInput)
      : await this.metadata.createIssuer(input);
    if (result) {
      this.formOpen.set(false);
      this.saved.set(true);
    } else {
      this.formError.set(this.metadata.error() ?? 'The issuer could not be saved.');
    }
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

  location(issuer: Issuer): string {
    return [issuer.city, issuer.country]
      .filter((value): value is string => Boolean(value))
      .join(', ');
  }

  addressLine(issuer: Issuer): string {
    return [issuer.address, issuer.zipCode]
      .filter((value): value is string => Boolean(value))
      .join(' · ');
  }
}
