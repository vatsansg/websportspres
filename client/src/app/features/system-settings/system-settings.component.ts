import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SettingsService } from '../../core/settings.service';

// User-requested (2026-09-19, see workflow.md): SuperAdmin/Administrator-only page for
// the one global app-wide behavior toggle this app currently has - "Force Email Send"
// (see asset-upload.component.ts for what it actually gates). Route-guarded by
// adminGuard, same as Asset Management Settings/User Management.
@Component({
  selector: 'app-system-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './system-settings.component.html',
  styleUrl: './system-settings.component.scss',
})
export class SystemSettingsComponent implements OnInit {
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal(false);

  // The value currently saved on the server - `forceEmailSend` below is the editable
  // draft, reset to this on Cancel.
  private savedValue = true;
  forceEmailSend = true;

  constructor(private settings: SettingsService, private router: Router) {}

  async ngOnInit() {
    try {
      const current = await this.settings.getSettings();
      this.savedValue = current.forceEmailSend;
      this.forceEmailSend = current.forceEmailSend;
    } catch {
      this.error.set('Could not load System Settings.');
    } finally {
      this.loading.set(false);
    }
  }

  get isDirty(): boolean {
    return this.forceEmailSend !== this.savedValue;
  }

  async save() {
    this.error.set(null);
    this.success.set(false);
    this.saving.set(true);
    try {
      const result = await this.settings.updateSettings({ forceEmailSend: this.forceEmailSend });
      this.savedValue = result.forceEmailSend;
      this.forceEmailSend = result.forceEmailSend;
      this.success.set(true);
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse && err.error?.error
          ? err.error.error
          : 'Could not save System Settings. Please try again.'
      );
    } finally {
      this.saving.set(false);
    }
  }

  cancel() {
    this.forceEmailSend = this.savedValue;
    this.error.set(null);
    this.success.set(false);
  }

  back() {
    this.router.navigateByUrl('/');
  }
}
