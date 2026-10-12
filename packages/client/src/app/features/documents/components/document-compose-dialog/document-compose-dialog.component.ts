import { ChangeDetectionStrategy, Component, input, OnInit, output, signal } from '@angular/core';
import type { Document } from '@binder/common';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';

type ComposeSourceSelection = {
  document: Document;
  startPage: number;
  endPage: number;
};

export type DocumentComposeRequest = {
  sources: Array<{ documentUuid: string; startPage: number; endPage: number }>;
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
export class DocumentComposeDialogComponent implements OnInit {
  readonly targetTitle = input.required<string>();
  readonly sourceDocuments = input.required<Document[]>();
  readonly targetPageCount = input.required<number>();
  readonly errorMessage = input<string | null>(null);
  readonly closed = output<void>();
  readonly submitted = output<DocumentComposeRequest>();
  readonly sources = signal<ComposeSourceSelection[]>([]);
  readonly insertAfterPage = signal(0);
  readonly copyMetadata = signal(true);
  readonly autoApplySuggestions = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.sources.set(
      this.sourceDocuments().map((document) => ({
        document,
        startPage: 1,
        endPage: Math.max(1, document.pageCount ?? 1),
      })),
    );
  }

  setPage(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.insertAfterPage.set(value);
    this.error.set(null);
  }

  setSourcePage(index: number, edge: 'startPage' | 'endPage', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.sources.update((sources) =>
      sources.map((source, sourceIndex) => {
        if (sourceIndex !== index) return source;
        const pageCount = Math.max(1, source.document.pageCount ?? 1);
        const boundedValue = Math.max(1, Math.min(pageCount, value));
        if (edge === 'startPage') {
          return {
            ...source,
            startPage: boundedValue,
            endPage: Math.max(source.endPage, boundedValue),
          };
        }
        return { ...source, endPage: Math.max(source.startPage, boundedValue) };
      }),
    );
    this.error.set(null);
  }

  moveSource(index: number, offset: -1 | 1): void {
    const destination = index + offset;
    const sources = this.sources();
    if (!sources[index] || !sources[destination]) return;
    const reordered = [...sources];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    this.sources.set(reordered);
  }

  removeSource(index: number): void {
    const sources = this.sources().filter((_source, sourceIndex) => sourceIndex !== index);
    this.sources.set(sources);
  }

  totalSourcePages(): number {
    return this.sources().reduce(
      (total, source) => total + source.endPage - source.startPage + 1,
      0,
    );
  }

  submit(): void {
    const insertAfterPage = this.insertAfterPage();
    if (
      !Number.isInteger(insertAfterPage) ||
      insertAfterPage < 0 ||
      insertAfterPage > this.targetPageCount()
    ) {
      this.error.set('documents.composeInvalidPage');
      return;
    }
    if (
      this.sources().length === 0 ||
      this.sources().some(
        (source) =>
          source.startPage < 1 ||
          source.startPage > source.endPage ||
          source.endPage > Math.max(1, source.document.pageCount ?? 1),
      )
    ) {
      this.error.set('documents.composeInvalidSourcePages');
      return;
    }

    this.submitted.emit({
      sources: this.sources().map(({ document, startPage, endPage }) => ({
        documentUuid: document.uuid,
        startPage,
        endPage,
      })),
      insertAfterPage,
      copyMetadata: this.copyMetadata(),
      autoApplySuggestions: this.autoApplySuggestions(),
    });
  }
}
