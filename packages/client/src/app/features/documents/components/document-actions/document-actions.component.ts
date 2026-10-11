import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { Document } from '@binder/common';
import { ApplicationService } from '../../../../common/application.service';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';
import { DocumentsService } from '../../services/documents.service';

@Component({
  selector: 'binder-document-actions',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './document-actions.component.html',
  styleUrl: './document-actions.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentActionsComponent {
  readonly document = input.required<Document>();
  readonly compact = input(false);
  readonly suggestionLoading = input(false);

  readonly open = output<void>();
  readonly metadata = output<void>();
  readonly suggest = output<void>();
  readonly requeue = output<void>();
  readonly deleteRequested = output<void>();
  readonly splitRequested = output<void>();

  private readonly application = inject(ApplicationService);
  private readonly documents = inject(DocumentsService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly fileUrl = computed(() =>
    this.application.getApiUrl('v1', 'documents/' + this.document().uuid + '/file'),
  );
  readonly archiveUrl = computed(() => this.document().archiveUrl);
  readonly archiveAvailable = computed(
    () =>
      this.canCreateArchive() &&
      this.document().archiveStatus === 'ready' &&
      this.archiveUrl() !== null,
  );
  readonly canDownload = computed(() =>
    this.documents.supportsMimeCapability(this.document().mimeType, 'download'),
  );
  readonly canCreateArchive = computed(() =>
    this.documents.supportsMimeCapability(this.document().mimeType, 'pdfa'),
  );
  readonly canSplit = computed(() =>
    this.documents.supportsMimeCapability(this.document().mimeType, 'split'),
  );
  readonly downloadMenuOpen = signal(false);
  readonly contentAvailable = computed(
    () => !['uploaded', 'scanning', 'quarantined'].includes(this.document().status),
  );
  readonly canRequeue = computed(() => {
    const status = this.document().status;
    return status === 'failed' || status === 'ready' || status === 'quarantined';
  });

  toggleDownloadMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.downloadMenuOpen.update((open) => !open);
  }

  closeDownloadMenu(): void {
    this.downloadMenuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.closeDownloadMenu();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeDownloadMenu();
  }
}
