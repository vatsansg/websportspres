import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type UserRole = 'SuperAdmin' | 'Administrator' | 'NormalUser';

export interface SessionUser {
  username: string;
  role: UserRole;
  provider?: 'local' | 'azuread';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly currentUser = signal<SessionUser | null>(null);
  readonly checkedSession = signal(false);

  constructor(private http: HttpClient) {}

  async loadSession(): Promise<SessionUser | null> {
    try {
      const user = await firstValueFrom(this.http.get<SessionUser>('/api/auth/me'));
      this.currentUser.set(user);
      return user;
    } catch {
      this.currentUser.set(null);
      return null;
    } finally {
      this.checkedSession.set(true);
    }
  }

  async loginLocal(username: string, password: string): Promise<SessionUser> {
    const user = await firstValueFrom(
      this.http.post<SessionUser>('/api/auth/login', { username, password })
    );
    this.currentUser.set(user);
    return user;
  }

  async exchangeAzureAdToken(accessToken: string): Promise<SessionUser> {
    const user = await firstValueFrom(
      this.http.post<SessionUser>(
        '/api/auth/aad/session',
        {},
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
    );
    this.currentUser.set(user);
    return user;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await firstValueFrom(
      this.http.post('/api/auth/change-password', { currentPassword, newPassword })
    );
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', {}));
    this.currentUser.set(null);
  }
}
