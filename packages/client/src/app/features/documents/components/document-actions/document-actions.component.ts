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
  changeDetection: ChangeDetectionStrategy.OnPush
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

  readonly fileUrl = computed(() => this.application.getApiUrl('v1', 'documents/' + this.document().uuid + '/file'));
  readonly canRequeue = computed(() => {
    const status = this.document().status;
    return status === 'failed' || status === 'ready';
  });
}
