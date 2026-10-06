import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { PasswordResetConfirmInputSchema, PasswordResetRequestInputSchema } from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../../common/application.service';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';

@Component({
  selector: 'binder-password-reset',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './password-reset.component.html',
  styleUrl: './password-reset.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordResetComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly app = inject(ApplicationService);
  readonly i18n = inject(I18nService);
  readonly token = signal('');
  readonly identifier = signal('');
  readonly password = signal('');
  readonly confirmation = signal('');
  readonly tokenValid = signal<boolean | null>(null);
  readonly submitting = signal(false);
  readonly success = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    this.token.set(token);
    if (token) void this.validateToken(token);
  }

  isConfirm(): boolean {
    return this.token().length > 0;
  }

  private async validateToken(token: string): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ data?: { valid?: boolean } }>(
          `${this.app.getApiUrl('v1', 'auth/password-reset/validate')}?token=${encodeURIComponent(token)}`,
          { withCredentials: true },
        ),
      );
      this.tokenValid.set(response.data?.valid === true);
    } catch {
      this.tokenValid.set(false);
    }
  }

  async request(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const input = PasswordResetRequestInputSchema.safeParse({ identifier: this.identifier() });
    if (!input.success) {
      this.error.set(this.i18n.t('passwordReset.identifierRequired'));
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post(this.app.getApiUrl('v1', 'auth/password-reset/request'), input.data, {
          withCredentials: true,
        }),
      );
      this.success.set(true);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.submitting.set(false);
    }
  }

  async confirm(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.password() !== this.confirmation()) {
      this.error.set(this.i18n.t('password.mismatch'));
      return;
    }
    const input = PasswordResetConfirmInputSchema.safeParse({
      token: this.token(),
      newPassword: this.password(),
    });
    if (!input.success) {
      this.error.set(this.i18n.t('passwordReset.passwordInvalid'));
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<{ data?: { accepted?: boolean } }>(
          this.app.getApiUrl('v1', 'auth/password-reset/confirm'),
          input.data,
          { withCredentials: true },
        ),
      );
      if (response.data?.accepted !== true) {
        this.error.set(this.i18n.t('passwordReset.invalidLink'));
        return;
      }
      this.success.set(true);
      this.password.set('');
      this.confirmation.set('');
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.submitting.set(false);
    }
  }

  async backToLogin(): Promise<void> {
    await this.router.navigate(['/']);
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string')
      return error.error.message;
    return this.i18n.t('passwordReset.serverError');
  }
}
