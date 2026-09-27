import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';

@Component({
  selector: 'binder-login',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginComponent {
  readonly username = signal('');
  readonly password = signal('');
  ssoActive = signal(false);

  constructor(readonly auth: AuthService) {

    void this.auth.isSSOActive()
      .then((result) => this.ssoActive.set(result))
      .catch(() => this.ssoActive.set(false));

  }

  async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (await this.auth.login(this.username(), this.password())) {
      this.password.set('');
    }
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
