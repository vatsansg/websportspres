import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.scss',
})
export class ChangePasswordComponent {
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  readonly error = signal<string | null>(null);
  readonly success = signal(false);
  readonly loading = signal(false);

  constructor(private auth: AuthService, private router: Router) {}

  async submit() {
    this.error.set(null);
    this.success.set(false);

    if (this.newPassword !== this.confirmPassword) {
      this.error.set('New password and confirmation do not match.');
      return;
    }
    if (this.newPassword.length < 8) {
      this.error.set('New password must be at least 8 characters.');
      return;
    }

    this.loading.set(true);
    try {
      await this.auth.changePassword(this.currentPassword, this.newPassword);
      this.success.set(true);
      this.currentPassword = this.newPassword = this.confirmPassword = '';
    } catch {
      this.error.set('Could not change password - check your current password and try again.');
    } finally {
      this.loading.set(false);
    }
  }

  back() {
    this.router.navigateByUrl('/');
  }
}
