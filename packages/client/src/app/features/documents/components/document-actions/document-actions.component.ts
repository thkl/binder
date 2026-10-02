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

  private readonly application = inject(ApplicationService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly fileUrl = computed(() =>
    this.application.getApiUrl('v1', 'documents/' + this.document().uuid + '/file'),
  );
  readonly archiveUrl = computed(() => this.document().archiveUrl);
  readonly archiveAvailable = computed(
    () => this.document().archiveStatus === 'ready' && this.archiveUrl() !== null,
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
