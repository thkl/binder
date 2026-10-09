import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';

export type DocumentComposeRequest = {
  insertAfterPage: number;
  copyMetadata: boolean;
  autoApplySuggestions: boolean;
};

@Component({
  selector: 'binder-document-compose-dialog',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './document-compose-dialog.component.html',
  styleUrl: './document-compose-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentComposeDialogComponent {
  readonly targetTitle = input.required<string>();
  readonly sourceTitle = input.required<string>();
  readonly targetPageCount = input.required<number>();
  readonly sourcePageCount = input.required<number>();
  readonly errorMessage = input<string | null>(null);
  readonly closed = output<void>();
  readonly submitted = output<DocumentComposeRequest>();
  readonly insertAfterPage = signal(0);
  readonly copyMetadata = signal(true);
  readonly autoApplySuggestions = signal(false);
  readonly error = signal<string | null>(null);

  setPage(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.insertAfterPage.set(value);
    this.error.set(null);
  }

  submit(): void {
    const page = this.insertAfterPage();
    if (!Number.isInteger(page) || page < 0 || page > this.targetPageCount()) {
      this.error.set('documents.composeInvalidPage');
      return;
    }
    this.submitted.emit({
      insertAfterPage: page,
      copyMetadata: this.copyMetadata(),
      autoApplySuggestions: this.autoApplySuggestions(),
    });
  }
}
