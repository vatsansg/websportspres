import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { DirectoryCandidate, ManagedUser, UsersService } from '../../core/users.service';

type AssignableRole = 'Administrator' | 'NormalUser';

// Step 5 follow-up (2026-09-18, per the user's explicit request): User Management for
// Admin/SuperAdmin. Administrator/NormalUser accounts are Azure AD-authenticated but no
// longer self-provisioning (see server auth/routes.js's /aad/session) - someone has to
// add them here first, which is what turns "can sign in with their WTT account" on.
// Permission matrix (server-enforced, this UI only mirrors it so options that would be
// rejected aren't even offered): SuperAdmin can add/edit/remove Administrator or
// NormalUser; Administrator can only add/edit/remove NormalUser.
@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.scss',
})
export class UserManagementComponent implements OnInit {
  readonly users = signal<ManagedUser[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly searchQuery = signal('');
  readonly candidates = signal<DirectoryCandidate[]>([]);
  readonly searching = signal(false);
  readonly searchError = signal<string | null>(null);
  selectedCandidate: DirectoryCandidate | null = null;
  manualEmail = '';
  newUserRole: AssignableRole = 'NormalUser';
  readonly adding = signal(false);
  readonly addError = signal<string | null>(null);

  readonly savingId = signal<number | null>(null);
  readonly confirmingRemoveId = signal<number | null>(null);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private usersService: UsersService, public auth: AuthService) {}

  get assignableRoles(): AssignableRole[] {
    return this.auth.currentUser()?.role === 'SuperAdmin' ? ['Administrator', 'NormalUser'] : ['NormalUser'];
  }

  async ngOnInit() {
    this.newUserRole = this.assignableRoles[this.assignableRoles.length - 1];
    await this.reload();
  }

  async reload() {
    this.loading.set(true);
    try {
      this.users.set(await this.usersService.listUsers());
    } catch {
      this.error.set('Could not load users.');
    } finally {
      this.loading.set(false);
    }
  }

  canManage(user: ManagedUser): boolean {
    if (user.authProvider !== 'azuread') return false;
    if (user.username === this.auth.currentUser()?.username) return false;
    return (this.assignableRoles as string[]).includes(user.role);
  }

  onSearchInput(value: string) {
    this.searchQuery.set(value);
    this.selectedCandidate = null;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (value.trim().length < 2) {
      this.candidates.set([]);
      return;
    }
    this.searchTimer = setTimeout(() => this.runSearch(value.trim()), 350);
  }

  private async runSearch(q: string) {
    this.searching.set(true);
    this.searchError.set(null);
    try {
      this.candidates.set(await this.usersService.searchDirectory(q));
    } catch {
      this.searchError.set('Directory search is unavailable right now - you can still add someone by typing their exact email below.');
      this.candidates.set([]);
    } finally {
      this.searching.set(false);
    }
  }

  pickCandidate(candidate: DirectoryCandidate) {
    this.selectedCandidate = candidate;
    this.candidates.set([]);
    this.searchQuery.set(candidate.email);
  }

  async addUser() {
    this.addError.set(null);
    const email = (this.selectedCandidate?.email ?? this.manualEmail).trim();
    if (!email) {
      this.addError.set('Search for a person, or type their exact worldtabletennis.com email.');
      return;
    }

    this.adding.set(true);
    try {
      await this.usersService.addUser(email, this.newUserRole, this.selectedCandidate?.displayName);
      this.selectedCandidate = null;
      this.manualEmail = '';
      this.searchQuery.set('');
      this.candidates.set([]);
      await this.reload();
    } catch (err) {
      if (err instanceof HttpErrorResponse && (err.status === 400 || err.status === 403 || err.status === 409)) {
        this.addError.set(err.error?.error ?? 'Could not add this user.');
      } else {
        this.addError.set('Could not add this user. Please try again.');
      }
    } finally {
      this.adding.set(false);
    }
  }

  async changeRole(user: ManagedUser, role: string) {
    this.savingId.set(user.id);
    this.error.set(null);
    try {
      await this.usersService.updateRole(user.id, role as AssignableRole);
      await this.reload();
    } catch (err) {
      this.error.set(err instanceof HttpErrorResponse ? err.error?.error ?? 'Could not update role.' : 'Could not update role.');
    } finally {
      this.savingId.set(null);
    }
  }

  // Step 5 UX consistency: this app deliberately avoids native window.confirm()/alert()
  // for user-facing confirmation (see Step 2's own switch away from alert() to an
  // in-page panel) - a native confirm() also blocks the renderer entirely, which is what
  // broke this exact flow during this step's own browser-automation testing. An inline
  // two-step "Remove -> Yes, Remove / Cancel" replaces it instead.
  requestRemove(user: ManagedUser) {
    this.confirmingRemoveId.set(user.id);
  }

  cancelRemove() {
    this.confirmingRemoveId.set(null);
  }

  async confirmRemove(user: ManagedUser) {
    this.savingId.set(user.id);
    this.error.set(null);
    try {
      await this.usersService.removeUser(user.id);
      this.confirmingRemoveId.set(null);
      await this.reload();
    } catch (err) {
      this.error.set(err instanceof HttpErrorResponse ? err.error?.error ?? 'Could not remove user.' : 'Could not remove user.');
    } finally {
      this.savingId.set(null);
    }
  }
}
