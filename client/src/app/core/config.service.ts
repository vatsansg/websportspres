import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface RuntimeConfig {
  appName: string;
  azureAd: {
    tenantId: string | null;
    clientId: string | null;
    configured: boolean;
  };
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private cached: RuntimeConfig | null = null;

  constructor(private http: HttpClient) {}

  async load(): Promise<RuntimeConfig> {
    if (this.cached) return this.cached;
    this.cached = await firstValueFrom(this.http.get<RuntimeConfig>('/api/config'));
    return this.cached;
  }
}
