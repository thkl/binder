import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';
import { PushNotificationsService } from '../../services/push-notifications.service';

@Component({
  selector: 'binder-push-notifications', standalone: true, imports: [TranslatePipe],
  templateUrl: './push-notifications.component.html', styleUrl: './push-notifications.component.css', changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PushNotificationsComponent implements OnInit {
  readonly push = inject(PushNotificationsService);
  ngOnInit(): void { void this.push.load(); }

  updateText(key: 'keyId' | 'teamId' | 'topic' | 'pushoverAppToken' | 'pushoverUserKey', event: Event): void {
    this.push.update({ [key]: (event.target as HTMLInputElement).value });
  }
  updateProvider(event: Event): void {
    this.push.update({ provider: (event.target as HTMLSelectElement).value as 'apns' | 'pushover' });
  }
  updateBoolean(key: 'enabled' | 'documentAdded' | 'processingComplete' | 'processingFailed', event: Event): void {
    this.push.update({ [key]: (event.target as HTMLInputElement).checked });
  }
  async selectKey(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.push.uploadKey(file);
    input.value = '';
  }

  registeredDate(value: string): string {
    return new Date(value).toLocaleString();
  }
}
