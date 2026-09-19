import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';

// Step 5 kickoff item 6: the app previously had no persistent chrome - every page built
// its own header/back-button. This is the real app shell every authenticated route now
// renders inside (header + left nav + <router-outlet>), replacing the old
// "dashboard-shell" placeholder that mixed shell chrome with page content in one
// component.
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent {
  constructor(public auth: AuthService, private router: Router) {}

  get isAdmin(): boolean {
    const role = this.auth.currentUser()?.role;
    return role === 'SuperAdmin' || role === 'Administrator';
  }

  // User-requested (2026-09-19, see workflow.md): navigates first, then clears the
  // session only if navigation actually succeeded - navigateByUrl() runs the Asset
  // Upload page's CanDeactivate guard (unsent-email.guard.ts) before resolving, so a user
  // with unsent changes still gets the chance to send/confirm from Sign Out, not just
  // from "Back to Dashboard". The previous order (clear session, then navigate) would
  // have logged the user out before that guard even asked.
  async logout() {
    const navigated = await this.router.navigateByUrl('/login');
    if (navigated) {
      await this.auth.logout();
    }
  }
}
