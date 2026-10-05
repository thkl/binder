import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { EmailImportConfig, EmailImportService } from '../../services/email-import.service';
import { ConfirmDialogComponent } from '../../../../common/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'binder-email-import',
  standalone: true,
  imports: [TranslatePipe, ConfirmDialogComponent],
  templateUrl: './email-import.component.html',
  styleUrl: './email-import.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailImportComponent implements OnInit {
  readonly service = inject(EmailImportService);
  readonly i18n = inject(I18nService);
  readonly enabled = signal(false);
  readonly host = signal('');
  readonly port = signal(993);
  readonly secure = signal(true);
  readonly username = signal('');
  readonly password = signal('');
  readonly mailbox = signal('INBOX');
  readonly pollIntervalMinutes = signal(15);
  readonly deleteAfterImport = signal(false);
  readonly trustedSenders = signal('');
  readonly passwordChanged = signal(false);
  readonly saved = signal(false);
  readonly confirmDelete = signal(false);

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    const config = await this.service.load();
    if (config) this.setValues(config);
  }

  async save(): Promise<void> {
    this.saved.set(false);
    const senders = this.trustedSenders().split(/[\n,;]/u).map((sender) => sender.trim().toLowerCase()).filter(Boolean);
    const input: Record<string, unknown> = {
      enabled: this.enabled(), host: this.host().trim(), port: Number(this.port()), secure: this.secure(),
      username: this.username().trim(), mailbox: this.mailbox().trim() || 'INBOX',
      pollIntervalMs: Number(this.pollIntervalMinutes()) * 60_000,
      deleteAfterImport: this.deleteAfterImport(), trustedSenders: senders,
    };
    if (this.passwordChanged()) input['password'] = this.password();
    const config = await this.service.save(input);
    if (config) { this.setValues(config); this.saved.set(true); }
  }

  requestDelete(): void {
    if (!this.enabled() && this.service.config()) this.confirmDelete.set(true);
  }

  cancelDelete(): void {
    this.confirmDelete.set(false);
  }

  async deleteSettings(): Promise<void> {
    this.confirmDelete.set(false);
    if (!(await this.service.delete())) return;
    this.enabled.set(false);
    this.host.set('');
    this.port.set(993);
    this.secure.set(true);
    this.username.set('');
    this.password.set('');
    this.mailbox.set('INBOX');
    this.pollIntervalMinutes.set(15);
    this.deleteAfterImport.set(false);
    this.trustedSenders.set('');
    this.passwordChanged.set(false);
    this.saved.set(false);
  }

  private setValues(config: EmailImportConfig): void {
    this.enabled.set(config.enabled); this.host.set(config.host); this.port.set(config.port);
    this.secure.set(config.secure); this.username.set(config.username); this.password.set('');
    this.passwordChanged.set(false); this.mailbox.set(config.mailbox);
    this.pollIntervalMinutes.set(Math.max(1, Math.round(config.pollIntervalMs / 60_000)));
    this.deleteAfterImport.set(config.deleteAfterImport); this.trustedSenders.set(config.trustedSenders.join('\n'));
  }
}
