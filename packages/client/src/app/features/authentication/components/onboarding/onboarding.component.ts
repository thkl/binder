import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { AiProviderManagerComponent } from '../../../settings/components/ai-provider-manager/ai-provider-manager.component';

@Component({
  selector: 'binder-onboarding',
  standalone: true,
  imports: [TranslatePipe, AiProviderManagerComponent],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingComponent {
  readonly setupSecret = signal('');
  readonly username = signal('admin');
  readonly password = signal('');
  readonly confirmation = signal('');
  readonly validationError = signal<string | null>(null);
  readonly step = signal<'admin' | 'ai'>('admin');

  constructor(
    readonly auth: AuthService,
    private readonly i18n: I18nService,
  ) {}

  async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.validationError.set(null);

    if (this.password() !== this.confirmation()) {
      this.validationError.set(this.i18n.t('setup.mismatch'));
      return;
    }

    if (await this.auth.createAdministrator(this.setupSecret(), this.username(), this.password())) {
      this.setupSecret.set('');
      this.password.set('');
      this.confirmation.set('');
      this.step.set('ai');
    }
  }

  finishOnboarding(): void {
    this.auth.finishOnboarding();
  }

  skipAi(): void {
    this.auth.finishOnboarding();
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
