import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';

export type DocumentSplitRequest = {
  splitAfterPage: number;
  autoApplySuggestions: boolean;
};

@Component({
  selector: 'binder-document-split-dialog',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './document-split-dialog.component.html',
  styleUrl: './document-split-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentSplitDialogComponent {
  readonly documentTitle = input.required<string>();
  readonly pageCount = input.required<number>();
  readonly closed = output<void>();
  readonly submitted = output<DocumentSplitRequest>();
  readonly splitAfterPage = signal(1);
  readonly autoApplySuggestions = signal(false);
  readonly error = signal<string | null>(null);

  setPage(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.splitAfterPage.set(value);
    this.error.set(null);
  }

  submit(): void {
    const page = this.splitAfterPage();
    if (!Number.isInteger(page) || page < 1 || page >= this.pageCount()) {
      this.error.set('documents.splitInvalidPage');
      return;
    }
    this.submitted.emit({
      splitAfterPage: page,
      autoApplySuggestions: this.autoApplySuggestions(),
    });
  }
}
