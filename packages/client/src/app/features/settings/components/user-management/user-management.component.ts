import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ManagedUser } from '@binder/common';
import { ConfirmDialogComponent } from '../../../../common/components/confirm-dialog/confirm-dialog.component';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { AuthService } from '../../../authentication/services/auth.service';
import { UserManagementService } from '../../services/user-management.service';

@Component({
  selector: 'binder-user-management',
  standalone: true,
  imports: [ConfirmDialogComponent, TranslatePipe],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserManagementComponent implements OnInit {
  readonly management = inject(UserManagementService);
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);

  readonly editingUuid = signal<string | null>(null);
  readonly username = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly isAdmin = signal(false);
  readonly isActive = signal(true);
  readonly saved = signal(false);
  readonly pendingDeactivateUuid = signal<string | null>(null);

  readonly editingUser = computed(() => {
    const uuid = this.editingUuid();
    return uuid ? (this.management.users().find((user) => user.uuid === uuid) ?? null) : null;
  });

  ngOnInit(): void {
    void this.management.load();
  }

  startCreate(): void {
    this.editingUuid.set(null);
    this.username.set('');
    this.email.set('');
    this.password.set('');
    this.isAdmin.set(false);
    this.isActive.set(true);
    this.saved.set(false);
  }

  edit(user: ManagedUser): void {
    this.editingUuid.set(user.uuid);
    this.username.set(user.username);
    this.email.set(user.email ?? '');
    this.password.set('');
    this.isAdmin.set(user.isAdmin);
    this.isActive.set(user.isActive);
    this.saved.set(false);
  }

  updateText(target: 'username' | 'email' | 'password', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (target === 'username') this.username.set(value);
    if (target === 'email') this.email.set(value);
    if (target === 'password') this.password.set(value);
    this.saved.set(false);
  }

  updateCheckbox(target: 'isAdmin' | 'isActive', event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    if (target === 'isAdmin') this.isAdmin.set(value);
    if (target === 'isActive') this.isActive.set(value);
    this.saved.set(false);
  }

  async save(): Promise<void> {
    const user = this.editingUser();
    if (user && user.isActive && !this.isActive()) {
      this.pendingDeactivateUuid.set(user.uuid);
      return;
    }
    await this.persist();
  }

  cancelDeactivate(): void {
    this.pendingDeactivateUuid.set(null);
    this.isActive.set(true);
  }

  async confirmDeactivate(): Promise<void> {
    this.pendingDeactivateUuid.set(null);
    await this.persist();
  }

  private async persist(): Promise<void> {
    this.saved.set(false);
    const password = this.password().trim();
    const email = this.email().trim();
    const user = this.editingUser();

    if (!user) {
      const created = await this.management.create({
        username: this.username(),
        email: email || null,
        password: password || null,
        isAdmin: this.isAdmin(),
      });
      if (created) {
        this.startCreate();
        this.saved.set(true);
      }
      return;
    }

    const updated = await this.management.update(user.uuid, {
      username: this.username(),
      email: email || null,
      isAdmin: this.isAdmin(),
      isActive: this.isActive(),
    });
    if (!updated) return;

    if (password) {
      const passwordUpdated = await this.management.resetPassword(user.uuid, {
        newPassword: password,
      });
      if (!passwordUpdated) return;
    }

    this.password.set('');
    this.saved.set(true);
  }
}
