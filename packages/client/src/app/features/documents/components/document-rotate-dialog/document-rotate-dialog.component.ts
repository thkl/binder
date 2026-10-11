import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';

export type DocumentRotateRequest = {
  pageNumber: number;
  rotationDegrees: -90 | 90 | 180;
};

@Component({
  selector: 'binder-document-rotate-dialog',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './document-rotate-dialog.component.html',
  styleUrl: './document-rotate-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentRotateDialogComponent {
  readonly documentTitle = input.required<string>();
  readonly pageCount = input.required<number>();
  readonly errorMessage = input<string | null>(null);
  readonly busy = input(false);
  readonly closed = output<void>();
  readonly submitted = output<DocumentRotateRequest>();
  readonly pageNumber = signal(1);
  readonly error = signal<string | null>(null);

  setPage(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.pageNumber.set(value);
    this.error.set(null);
  }

  rotate(rotationDegrees: -90 | 90 | 180): void {
    const page = this.pageNumber();
    if (!Number.isInteger(page) || page < 1 || page > this.pageCount()) {
      this.error.set('documents.rotateInvalidPage');
      return;
    }
    this.submitted.emit({ pageNumber: page, rotationDegrees });
  }
}
