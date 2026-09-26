import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { AuthService } from './features/authentication/services/auth.service';
import { ChangePasswordComponent } from './features/authentication/components/change-password/change-password.component';
import { LoginComponent } from './features/authentication/components/login/login.component';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'binder-root',
  standalone: true,
  imports: [LoginComponent, ChangePasswordComponent, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent implements OnInit {
  constructor(readonly auth: AuthService) {}

  ngOnInit(): void {
    void this.auth.restoreSession();
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }
}
