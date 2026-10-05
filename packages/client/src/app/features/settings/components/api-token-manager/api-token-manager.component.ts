import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'binder-api-token-manager',
  standalone: true,
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

  async revoke(uuid: string): Promise<void> {
    if (window.confirm('Revoke this token? Existing MCP connections will stop working.')) {
      await this.settings.revokeApiToken(uuid);
    }
  }
}
