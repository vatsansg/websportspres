import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

export interface AssetRuleFile {
  kind: "image" | "video";
  filenameRule: "exact" | "contains" | "any";
  requiredFilename: string | null;
  storageFilename: string;
  additionalCopy: string | null;
  fallbackFrom: string | null;
}

export interface OvrTriggerRule {
  id: string;
  label: string;
  destinations: string[];
  optional: boolean;
  files: AssetRuleFile[];
}

export interface AssetRules {
  sponsorAds: {
    destinations: string[];
    allowedFormats: string[];
    filenameMustNotContain: string[];
    image: { bitDepth: number; maxSizeMB: number };
    video: { maxSizeMB: number };
    resolution: {
      note: string;
      innerOuterDefault: { width: number; height: number };
      mainLedDefault: { width: number; height: number };
    };
  };
  ovrTriggers: OvrTriggerRule[];
  allSponsorLogo: { label: string; destinations: string[]; requiredFilename: string; storageFilename: string };
  rpi: {
    label: string;
    destinations: string[];
    filenameRule: string;
    requiredFilename: string;
    storageFilename: string;
    resolution: { width: number; height: number };
  };
  defaultAssets: { label: string; description: string; storageFilenames: { image: string; video: string } };
}

@Injectable({ providedIn: "root" })
export class AssetRulesService {
  constructor(private http: HttpClient) {}

  async getRules(): Promise<AssetRules> {
    return firstValueFrom(this.http.get<AssetRules>("/api/asset-rules"));
  }

  // Step 5: the raw, editable config (Admin/SuperAdmin only) - not the curated summary
  // above, which isn't a faithful round-trip of the underlying JSON.
  async getRawConfig(): Promise<unknown> {
    return firstValueFrom(this.http.get("/api/asset-rules/raw"));
  }

  async saveRawConfig(config: unknown): Promise<unknown> {
    return firstValueFrom(this.http.put("/api/asset-rules/raw", config));
  }
}
