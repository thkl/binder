import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
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
  readonly archive = output<void>();

  private readonly application = inject(ApplicationService);

  readonly fileUrl = computed(() =>
    this.application.getApiUrl('v1', 'documents/' + this.document().uuid + '/file'),
  );
  readonly archiveUrl = computed(() => this.document().archiveUrl);
  readonly archiveReady = computed(() => this.document().archiveStatus === 'ready');
  readonly archiveBusy = computed(() =>
    ['queued', 'processing'].includes(this.document().archiveStatus),
  );
  readonly contentAvailable = computed(
    () => !['uploaded', 'scanning', 'quarantined'].includes(this.document().status),
  );
  readonly canRequeue = computed(() => {
    const status = this.document().status;
    return status === 'failed' || status === 'ready' || status === 'quarantined';
  });
}
