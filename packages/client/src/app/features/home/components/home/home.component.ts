
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SearchService } from '../../services/search.service';

@Component({
  selector: 'binder-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomeComponent {
  readonly search = inject(SearchService);
  readonly searchQuery = signal('');
  readonly selectedType = signal('');
  readonly selectedCategory = signal('');
  readonly selectedTag = signal('');

  async submitSearch(event: Event): Promise<void> {
    event.preventDefault();
    await this.search.search(this.searchQuery(), {
      documentTypeUuid: this.selectedType() || undefined,
      categoryUuid: this.selectedCategory() || undefined,
      tagUuids: this.selectedTag() ? [this.selectedTag()] : undefined
    });
  }
}
