import { ChangeDetectionStrategy, Component, OnInit, input, output, signal } from '@angular/core';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';
import { SharingService } from '../../services/sharing.service';
import type { ShareGrant, ShareRecipient } from '@binder/common';

@Component({
  selector: 'binder-share-access',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './share-access.component.html',
  styleUrl: './share-access.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareAccessComponent implements OnInit {
  readonly resourceType = input.required<'documents' | 'folders'>();
  readonly resourceUuid = input.required<string>();
  readonly resourceName = input<string | null>(null);
  readonly close = output<void>();
  readonly recipients = signal<ShareRecipient[]>([]);
  readonly grants = signal<ShareGrant[]>([]);
  readonly selectedRecipient = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor(private readonly sharing: SharingService) {}

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.error.set(null);
    try {
      const [recipients, grants] = await Promise.all([
        this.sharing.listRecipients(),
        this.sharing.listGrants(this.resourceType(), this.resourceUuid()),
      ]);
      this.recipients.set(recipients);
      this.grants.set(grants);
    } catch {
      this.error.set('sharing.loadFailed');
    }
  }

  async add(): Promise<void> {
    const recipientUuid = this.selectedRecipient();
    if (!recipientUuid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.grants.set(await this.sharing.grant(this.resourceType(), this.resourceUuid(), recipientUuid));
      this.selectedRecipient.set('');
    } catch {
      this.error.set('sharing.saveFailed');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(recipientUuid: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.grants.set(await this.sharing.revoke(this.resourceType(), this.resourceUuid(), recipientUuid));
    } catch {
      this.error.set('sharing.saveFailed');
    } finally {
      this.busy.set(false);
    }
  }

  availableRecipients(): ShareRecipient[] {
    const granted = new Set(this.grants().map((grant) => grant.recipientUuid));
    return this.recipients().filter((recipient) => !granted.has(recipient.uuid));
  }
}
