import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';

// Minimal authenticated shell for Step 1 - proves the auth/session/RBAC framework works
// end-to-end. The real Dashboard/Event List (Web BRD Section 25) is built in Step 6.
@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-shell.component.html',
  styleUrl: './dashboard-shell.component.scss',
})
export class DashboardShellComponent {
  constructor(public auth: AuthService, private router: Router) {}

  async logout() {
    await this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
