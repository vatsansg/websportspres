import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AssetRulesService } from '../../core/asset-rules.service';

export type FilenameRule = 'exact' | 'contains' | 'any';
export type FileKind = 'image' | 'video';
export type Destination = 'inner' | 'outer' | 'main' | 'rpi';

export interface FileRuleForm {
  kind: FileKind;
  filenameRule: FilenameRule;
  requiredFilename: string;
  storageFilename: string;
  additionalCopy: string;
  fallbackFrom: string;
}

export interface TriggerTypeForm {
  id: string;
  label: string;
  destinations: Record<Destination, boolean>;
  optional: boolean;
  files: FileRuleForm[];
}

export interface AllSponsorLogoForm {
  id: string;
  label: string;
  destinations: Record<Destination, boolean>;
  filenameRule: FilenameRule;
  requiredFilename: string;
  storageFilename: string;
}

const ALL_DESTINATIONS: Destination[] = ['inner', 'outer', 'main', 'rpi'];

function emptyDestinations(): Record<Destination, boolean> {
  return { inner: false, outer: false, main: false, rpi: false };
}

function destinationsToForm(list: string[]): Record<Destination, boolean> {
  const form = emptyDestinations();
  for (const d of list) {
    if (d in form) form[d as Destination] = true;
  }
  return form;
}

function destinationsFromForm(form: Record<Destination, boolean>): Destination[] {
  return ALL_DESTINATIONS.filter((d) => form[d]);
}

function fileToForm(f: any): FileRuleForm {
  return {
    kind: f.kind ?? 'image',
    filenameRule: f.filenameRule ?? 'any',
    requiredFilename: f.requiredFilename ?? '',
    storageFilename: f.storageFilename ?? '',
    additionalCopy: f.additionalCopy ?? '',
    fallbackFrom: f.fallbackFrom ?? '',
  };
}

function fileFromForm(f: FileRuleForm): any {
  const out: any = {
    kind: f.kind,
    filenameRule: f.filenameRule,
    storageFilename: f.storageFilename.trim(),
  };
  if (f.filenameRule !== 'any' && f.requiredFilename.trim()) out.requiredFilename = f.requiredFilename.trim();
  if (f.additionalCopy.trim()) out.additionalCopy = f.additionalCopy.trim();
  if (f.fallbackFrom.trim()) out.fallbackFrom = f.fallbackFrom.trim();
  return out;
}

function newFileRule(): FileRuleForm {
  return { kind: 'image', filenameRule: 'exact', requiredFilename: '', storageFilename: '', additionalCopy: '', fallbackFrom: '' };
}

function newTriggerType(): TriggerTypeForm {
  return { id: '', label: '', destinations: emptyDestinations(), optional: false, files: [newFileRule()] };
}

// Step 5, redesigned per user feedback 2026-09-18: a free-text JSON textarea let an admin
// silently break the schema the app's own validation and every OVR Trigger route depends
// on. This structured form instead exposes exactly the keys the schema has (marked
// required/optional per templatesStore.js's own validateShape()), so a save can only ever
// produce a well-formed config - the JSON is assembled from/parsed into this form, never
// hand-edited directly. Server-side validateShape() still checks it on save too (defense
// in depth - this form is not the only thing standing between a request and the blob).
@Component({
  selector: 'app-asset-rules-edit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './asset-rules-edit.component.html',
  styleUrl: './asset-rules-edit.component.scss',
})
export class AssetRulesEditComponent implements OnInit {
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);

  triggerTypes: TriggerTypeForm[] = [];
  allSponsorLogo: AllSponsorLogoForm = {
    id: 'all_sponsor_logo',
    label: '',
    destinations: emptyDestinations(),
    filenameRule: 'exact',
    requiredFilename: '',
    storageFilename: '',
  };

  readonly destinations = ALL_DESTINATIONS;

  constructor(private assetRules: AssetRulesService, private router: Router) {}

  async ngOnInit() {
    try {
      const config: any = await this.assetRules.getRawConfig();
      this.triggerTypes = (config.ovrTriggerTypes ?? []).map((t: any) => ({
        id: t.id ?? '',
        label: t.label ?? '',
        destinations: destinationsToForm(t.destinations ?? []),
        optional: !!t.optional,
        files: (t.files ?? []).map(fileToForm),
      }));
      const logo = config.allSponsorLogo ?? {};
      this.allSponsorLogo = {
        id: logo.id ?? 'all_sponsor_logo',
        label: logo.label ?? '',
        destinations: destinationsToForm(logo.destinations ?? []),
        filenameRule: logo.filenameRule ?? 'exact',
        requiredFilename: logo.requiredFilename ?? '',
        storageFilename: logo.storageFilename ?? '',
      };
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 403) {
        this.error.set('You do not have permission to view or edit these settings.');
      } else {
        this.error.set('Could not load the asset rules configuration.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  addTriggerType() {
    this.triggerTypes.push(newTriggerType());
  }

  removeTriggerType(index: number) {
    this.triggerTypes.splice(index, 1);
  }

  addFileRule(trigger: TriggerTypeForm) {
    trigger.files.push(newFileRule());
  }

  removeFileRule(trigger: TriggerTypeForm, index: number) {
    trigger.files.splice(index, 1);
  }

  private validate(): string | null {
    if (this.triggerTypes.length === 0) return 'At least one OVR Trigger type is required.';
    const seenIds = new Set<string>();
    for (const t of this.triggerTypes) {
      if (!t.id.trim()) return 'Every trigger type needs an ID.';
      if (seenIds.has(t.id.trim())) return `Duplicate trigger type ID "${t.id}".`;
      seenIds.add(t.id.trim());
      if (!t.label.trim()) return `Trigger type "${t.id}" needs a label.`;
      if (destinationsFromForm(t.destinations).length === 0) {
        return `Trigger type "${t.id}" needs at least one destination.`;
      }
      if (t.files.length === 0) return `Trigger type "${t.id}" needs at least one file rule.`;
      for (const f of t.files) {
        if (!f.storageFilename.trim()) return `Trigger type "${t.id}": every file rule needs a storage filename.`;
        if (f.filenameRule !== 'any' && !f.requiredFilename.trim()) {
          return `Trigger type "${t.id}": filename rule "${f.filenameRule}" needs a required filename.`;
        }
      }
    }
    if (!this.allSponsorLogo.label.trim()) return 'All Sponsor Logo needs a label.';
    if (destinationsFromForm(this.allSponsorLogo.destinations).length === 0) {
      return 'All Sponsor Logo needs at least one destination.';
    }
    if (!this.allSponsorLogo.requiredFilename.trim()) return 'All Sponsor Logo needs a required filename.';
    if (!this.allSponsorLogo.storageFilename.trim()) return 'All Sponsor Logo needs a storage filename.';
    return null;
  }

  async save() {
    this.error.set(null);
    this.saved.set(false);

    const validationError = this.validate();
    if (validationError) {
      this.error.set(validationError);
      return;
    }

    const payload = {
      ovrTriggerTypes: this.triggerTypes.map((t) => ({
        id: t.id.trim(),
        label: t.label.trim(),
        destinations: destinationsFromForm(t.destinations),
        ...(t.optional ? { optional: true } : {}),
        files: t.files.map(fileFromForm),
      })),
      allSponsorLogo: {
        id: this.allSponsorLogo.id.trim() || 'all_sponsor_logo',
        label: this.allSponsorLogo.label.trim(),
        destinations: destinationsFromForm(this.allSponsorLogo.destinations),
        filenameRule: this.allSponsorLogo.filenameRule,
        requiredFilename: this.allSponsorLogo.requiredFilename.trim(),
        storageFilename: this.allSponsorLogo.storageFilename.trim(),
      },
    };

    this.saving.set(true);
    try {
      await this.assetRules.saveRawConfig(payload);
      this.saved.set(true);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 400) {
        const details = err.error?.details;
        this.error.set(
          Array.isArray(details) && details.length > 0
            ? details.join('; ')
            : err.error?.error ?? 'The configuration was rejected as invalid.'
        );
      } else if (err instanceof HttpErrorResponse && err.status === 403) {
        this.error.set('You do not have permission to save these settings.');
      } else {
        this.error.set('Could not save the configuration. Please try again.');
      }
    } finally {
      this.saving.set(false);
    }
  }

  cancel() {
    this.router.navigateByUrl('/');
  }
}
