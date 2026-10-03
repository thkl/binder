import {
  ChangeDetectionStrategy,
  Component,
  effect,
  HostListener,
  OnInit,
  signal,
} from '@angular/core';
import { AuthService } from './features/authentication/services/auth.service';
import { ChangePasswordComponent } from './features/authentication/components/change-password/change-password.component';
import { LoginComponent } from './features/authentication/components/login/login.component';
import { OnboardingComponent } from './features/authentication/components/onboarding/onboarding.component';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18nService, TranslatePipe } from './common/i18n/i18n.service';
import { InboxService } from './features/inbox/services/inbox.service';

type NavigationMenu = 'documents' | 'settings';

@Component({
  selector: 'binder-root',
  standalone: true,
  imports: [
    LoginComponent,
    OnboardingComponent,
    ChangePasswordComponent,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TranslatePipe,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  readonly openMenu = signal<NavigationMenu | null>(null);

  constructor(
    readonly auth: AuthService,
    readonly i18n: I18nService,
    readonly inbox: InboxService,
  ) {
    effect(() => {
      const user = this.auth.user();
      if (this.auth.loading()) return;

      if (user) {
        void this.inbox.loadNewDocumentCount();
      } else {
        this.inbox.newDocumentCount.set(0);
      }

      if (user?.isAdmin) {
        this.inbox.startLiveUpdates();
      } else {
        this.inbox.stopLiveUpdates();
      }
    });
  }

  ngOnInit(): void {
    void this.auth.restoreSession();
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }

  setLanguage(language: 'en' | 'de'): void {
    this.i18n.setLanguage(language);
  }

  toggleMenu(menu: NavigationMenu, event: Event): void {
    event.stopPropagation();
    this.openMenu.update((current) => (current === menu ? null : menu));
  }

  closeMenu(): void {
    this.openMenu.set(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && !target.closest('.nav-menu')) {
      this.closeMenu();
    }
  }
}
