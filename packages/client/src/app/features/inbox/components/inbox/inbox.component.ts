import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { InboxAiStatus, InboxItemStatus, InboxQueueItem } from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { InboxService } from '../../services/inbox.service';

@Component({
  selector: 'binder-inbox',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './inbox.component.html',
  styleUrl: './inbox.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InboxComponent implements OnDestroy, OnInit {
  readonly inbox = inject(InboxService);
  readonly i18n = inject(I18nService);
  readonly newCount = computed(() => this.inbox.items().filter((item) => item.status === 'new').length);
  readonly processingCount = computed(() => this.inbox.items().filter((item) => item.status === 'processing').length);
  readonly importedCount = computed(() => this.inbox.items().filter((item) => item.status === 'imported').length);

  ngOnInit(): void {
    void this.inbox.load();
    this.inbox.startLiveUpdates();
  }

  ngOnDestroy(): void {
    this.inbox.stopLiveUpdates();
  }

  async processAllWithAi(): Promise<void> {
    await this.inbox.processAllWithAi();
  }

  statusLabel(status: InboxItemStatus): string {
    return this.i18n.t(`inbox.status.${status}`);
  }

  aiStatusLabel(status: InboxAiStatus): string {
    return this.i18n.t(`inbox.aiStatus.${status}`);
  }

  suggestionTitle(item: InboxQueueItem): string | null {
    return item.aiSuggestion?.suggestedTitle ?? null;
  }

  trackByUuid(_: number, item: InboxQueueItem): string {
    return item.uuid;
  }
}
