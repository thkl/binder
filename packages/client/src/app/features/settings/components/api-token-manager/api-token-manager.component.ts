import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ConfirmDialogComponent } from '../../../../common/components/confirm-dialog/confirm-dialog.component';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'binder-api-token-manager',
  standalone: true,
  imports: [ConfirmDialogComponent],
  templateUrl: './api-token-manager.component.html',
  styleUrl: './api-token-manager.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiTokenManagerComponent implements OnInit {
  readonly settings = inject(SettingsService);
  readonly name = signal('');
  readonly allowWrite = signal(false);
  readonly createdToken = signal<string | null>(null);
  readonly saving = signal(false);
  readonly pendingRevokeUuid = signal<string | null>(null);

  ngOnInit(): void {
    void this.settings.loadApiTokens();
  }

  async create(): Promise<void> {
    if (!this.name().trim() || this.saving()) return;
    this.saving.set(true);
    const token = await this.settings.createApiToken({
      name: this.name().trim(),
      permissions: this.allowWrite() ? ['documents:read', 'documents:write'] : ['documents:read'],
    });
    if (token) {
      this.createdToken.set(token);
      this.name.set('');
      this.allowWrite.set(false);
    }
    this.saving.set(false);
  }

  revoke(uuid: string): void {
    this.pendingRevokeUuid.set(uuid);
  }

  cancelRevoke(): void {
    this.pendingRevokeUuid.set(null);
  }

  async confirmRevoke(): Promise<void> {
    const uuid = this.pendingRevokeUuid();
    this.pendingRevokeUuid.set(null);
    if (uuid) await this.settings.revokeApiToken(uuid);
  }
}
