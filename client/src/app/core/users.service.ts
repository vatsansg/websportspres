import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type UserRole = 'SuperAdmin' | 'Administrator' | 'NormalUser';

export interface ManagedUser {
  id: number;
  username: string;
  role: UserRole;
  authProvider: 'local' | 'azuread';
  displayName: string | null;
  addedBy: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface DirectoryCandidate {
  azureAdObjectId: string;
  displayName: string;
  email: string;
  userPrincipalName: string;
  isGuest: boolean;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  constructor(private http: HttpClient) {}

  async listUsers(): Promise<ManagedUser[]> {
    return firstValueFrom(this.http.get<ManagedUser[]>('/api/users'));
  }

  async searchDirectory(q: string): Promise<DirectoryCandidate[]> {
    return firstValueFrom(
      this.http.get<DirectoryCandidate[]>('/api/users/directory-search', { params: { q } })
    );
  }

  async addUser(username: string, role: 'Administrator' | 'NormalUser', displayName?: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/users', { username, role, displayName }));
  }

  async updateRole(id: number, role: 'Administrator' | 'NormalUser'): Promise<void> {
    await firstValueFrom(this.http.put(`/api/users/${id}`, { role }));
  }

  async removeUser(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/users/${id}`));
  }
}
