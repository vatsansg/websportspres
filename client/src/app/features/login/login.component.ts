import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ConfigService } from '../../core/config.service';
import { createMsalInstance } from '../../core/msal-instance';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  username = '';
  password = '';
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly azureAdConfigured = signal(false);

  constructor(
    private auth: AuthService,
    private config: ConfigService,
    private router: Router
  ) {
    this.config.load().then((c) => this.azureAdConfigured.set(c.azureAd.configured));
  }

  async signInLocal() {
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.auth.loginLocal(this.username, this.password);
      this.router.navigateByUrl('/');
    } catch {
      this.error.set('Invalid username or password.');
    } finally {
      this.loading.set(false);
    }
  }

  async signInWithMicrosoft() {
    this.error.set(null);
    this.loading.set(true);
    try {
      const runtimeConfig = await this.config.load();
      if (!runtimeConfig.azureAd.configured) {
        this.error.set('Azure AD sign-in is not configured yet.');
        return;
      }
      const msal = createMsalInstance(runtimeConfig);
      await msal.initialize();
      const result = await msal.loginPopup({ scopes: ['User.Read'] });
      await this.auth.exchangeAzureAdToken(result.accessToken);
      this.router.navigateByUrl('/');
    } catch {
      this.error.set('Microsoft sign-in failed.');
    } finally {
      this.loading.set(false);
    }
  }
}
