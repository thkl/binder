import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { DocumentListFacetOption } from '@binder/common';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';

@Component({
  selector: 'binder-document-filter-menu',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './document-filter-menu.component.html',
  styleUrl: './document-filter-menu.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentFilterMenuComponent {
  readonly label = input.required<string>();
  readonly options = input<DocumentListFacetOption[]>([]);
  readonly selectedValues = input<string[] | undefined>(undefined);
  readonly open = input(false);

  readonly toggle = output<void>();
  readonly applied = output<string[] | undefined>();
  readonly closed = output<void>();

  readonly optionSearch = signal('');
  readonly draftValues = signal<string[] | undefined>(undefined);

  readonly filteredOptions = computed(() => {
    const term = this.optionSearch().trim().toLocaleLowerCase();
    if (!term) return this.options();
    return this.options().filter((option) => option.label.toLocaleLowerCase().includes(term));
  });

  readonly draftCount = computed(() => {
    const selected = this.draftValues();
    return selected === undefined ? this.options().length : selected.length;
  });

  readonly hasActiveFilter = computed(() => this.selectedValues() !== undefined);

  openMenu(): void {
    this.resetDraft();
    this.toggle.emit();
  }

  closeMenu(): void {
    this.closed.emit();
  }

  selectAll(): void {
    this.draftValues.set(undefined);
  }

  selectNone(): void {
    this.draftValues.set([]);
  }

  isSelected(value: string): boolean {
    const selected = this.draftValues();
    return selected === undefined || selected.includes(value);
  }

  toggleOption(value: string): void {
    const allValues = this.options().map((option) => option.value);
    const selected = new Set(this.draftValues() ?? allValues);

    if (selected.has(value)) {
      selected.delete(value);
    } else {
      selected.add(value);
    }

    const next = [...selected];
    this.draftValues.set(next.length === allValues.length ? undefined : next);
  }

  apply(): void {
    this.applied.emit(this.draftValues());
    this.closed.emit();
  }

  trackOption(_index: number, option: DocumentListFacetOption): string {
    return option.value;
  }

  private resetDraft(): void {
    const selected = this.selectedValues();
    this.draftValues.set(selected === undefined ? undefined : [...selected]);
    this.optionSearch.set('');
  }
}
