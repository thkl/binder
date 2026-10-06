import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';

@Component({
  selector: 'binder-change-password',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangePasswordComponent {
  readonly title = input<string | null>(null);
  readonly message = input<string | null>(null);
  readonly changed = output<void>();

  readonly oldPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmation = signal('');
  readonly validationError = signal<string | null>(null);
  readonly changedSuccessfully = signal(false);

  constructor(
    readonly auth: AuthService,
    private readonly i18n: I18nService,
    private readonly router: Router,
  ) {}

  async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.validationError.set(null);

    if (this.newPassword() !== this.confirmation()) {
      this.validationError.set(this.i18n.t('password.mismatch'));
      return;
    }

    if (await this.auth.changePassword(this.oldPassword(), this.newPassword())) {
      this.oldPassword.set('');
      this.newPassword.set('');
      this.confirmation.set('');
      this.changedSuccessfully.set(true);
      this.changed.emit();
    }
  }

  async backToHome(): Promise<void> {
    await this.router.navigate(['/']);
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
