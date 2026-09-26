
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

  async submitSearch(event: Event): Promise<void> {
    event.preventDefault();
    await this.search.search(this.searchQuery());
  }
}
