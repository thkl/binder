import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { SavedSearch, SavedSearchKind } from '@binder/common';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';

export interface SavedSearchParameter {
  label: string;
  value: string;
}

@Component({
  selector: 'binder-saved-search-menu',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './saved-search-menu.component.html',
  styleUrl: './saved-search-menu.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SavedSearchMenuComponent {
  readonly searches = input<SavedSearch[]>([]);
  readonly kind = input<SavedSearchKind>('list');
  readonly selectedUuid = input<string | null>(null);
  readonly busy = input(false);
  readonly removing = input(false);
  readonly parameters = input<SavedSearchParameter[]>([]);
  readonly searchSelected = output<string>();
  readonly saveRequested = output<string>();
  readonly renameRequested = output<{ uuid: string; name: string }>();
  readonly removeRequested = output<string>();

  readonly isNaming = signal(false);
  readonly namingMode = signal<'create' | 'rename'>('create');
  readonly name = signal('');
  readonly availableSearches = computed(() => this.searches().filter((item) => item.definition.kind === this.kind()));
  readonly selectedSearch = computed(() => this.availableSearches().find((item) => item.uuid === this.selectedUuid()) ?? null);

  beginSave(): void {
    this.name.set('');
    this.namingMode.set('create');
    this.isNaming.set(true);
  }

  beginRename(): void {
    const selected = this.selectedSearch();
    if (!selected) return;
    this.name.set(selected.name);
    this.namingMode.set('rename');
    this.isNaming.set(true);
  }

  cancelSave(): void {
    this.isNaming.set(false);
    this.name.set('');
  }

  save(): void {
    const name = this.name().trim();
    if (!name) return;
    if (this.namingMode() === 'rename') {
      const uuid = this.selectedUuid();
      if (uuid) this.renameRequested.emit({ uuid, name });
    } else {
      this.saveRequested.emit(name);
    }
    this.cancelSave();
  }

  remove(): void {
    const uuid = this.selectedSearch()?.uuid;
    if (uuid) this.removeRequested.emit(uuid);
  }

  handleNameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelSave();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.save();
    }
  }
}
