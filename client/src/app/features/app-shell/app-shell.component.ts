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

  async logout() {
    await this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
