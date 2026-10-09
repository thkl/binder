import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApplicationService } from '../../../../common/application.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'binder-mobile-connection',
  standalone: true,
  templateUrl: './mobile-connection.component.html',
  styleUrl: './mobile-connection.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileConnectionComponent {
  readonly application = inject(ApplicationService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly serverUrl = signal(this.application.getMobileServerUrl() ?? '');
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  updateInput(event: Event): void {
    this.serverUrl.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  async save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.saving.set(true);
    this.error.set(null);

    try {
      const serverUrl = await this.application.saveMobileServerUrl(this.serverUrl());
      if (this.application.isNativeMobile()) {
        window.location.replace(serverUrl);
      } else {
        await this.auth.restoreSession();
        await this.router.navigateByUrl('/');
      }
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Could not connect. Check the address and try again.',
      );
    } finally {
      this.saving.set(false);
    }
  }

  cancel(): void {
    void this.router.navigateByUrl('/');
  }
}
