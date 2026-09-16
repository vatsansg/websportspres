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
      // openid/profile (implicit defaults) get us an ID token audienced to our own app
      // (aud = clientId) with the roles claim - that's what the backend validates
      // (src/auth/azureAdAuth.js). Do NOT request a Graph scope like User.Read here:
      // that would return an access token audienced to Graph instead, which the
      // backend's audience check would always reject.
      const result = await msal.loginPopup({ scopes: [] });
      await this.auth.exchangeAzureAdToken(result.idToken);
      this.router.navigateByUrl('/');
    } catch (err: any) {
      // Deliberately verbose while AAD sign-in is still being wired up - swap for a
      // generic message once this is fully working end-to-end.
      console.error('Microsoft sign-in failed:', err);
      const detail = err?.errorMessage || err?.message || String(err);
      this.error.set(`Microsoft sign-in failed: ${detail}`);
    } finally {
      this.loading.set(false);
    }
  }
}
