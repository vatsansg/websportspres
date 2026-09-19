import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

// User-requested (2026-09-19, see workflow.md): a single global "Force Email Send"
// setting - see server/src/settings/routes.js and db/migrations/010_system_settings.sql.
export interface SystemSettings {
  forceEmailSend: boolean;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  constructor(private http: HttpClient) {}

  async getSettings(): Promise<SystemSettings> {
    return firstValueFrom(this.http.get<SystemSettings>('/api/system-settings'));
  }

  async updateSettings(settings: SystemSettings): Promise<SystemSettings> {
    return firstValueFrom(this.http.put<SystemSettings>('/api/system-settings', settings));
  }
}
