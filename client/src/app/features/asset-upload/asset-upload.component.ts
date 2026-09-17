import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { EventDetail, EventSummary, EventsService } from '../../core/events.service';
import { SponsorAdDestination, SponsorAdsService } from '../../core/sponsor-ads.service';
import { SponsorDestinationSectionComponent } from './sponsor-destination-section.component';

// Web BRD Section 10: the Asset Upload page has two tabs, Sponsor Ads and OVR Match
// Triggers. Only Sponsor Ads is built as of Step 3 - OVR Match Triggers is Step 4's scope.
@Component({
  selector: 'app-asset-upload',
  standalone: true,
  imports: [CommonModule, FormsModule, SponsorDestinationSectionComponent],
  templateUrl: './asset-upload.component.html',
  styleUrl: './asset-upload.component.scss',
})
export class AssetUploadComponent implements OnInit {
  readonly events = signal<EventSummary[]>([]);
  readonly selectedEventId = signal<string | null>(null);
  readonly eventDetail = signal<EventDetail | null>(null);
  readonly selectedTableNumber = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  readonly loadingEvents = signal(true);
  readonly loadingEventDetail = signal(false);

  // Web BRD Section 14: destination selection happens once per upload batch - the same
  // files get copied into every checked destination, each of which then manages its own
  // sequence independently (Section 13) via the two sections below.
  uploadToInner = false;
  uploadToOuter = false;
  readonly dragOver = signal(false);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly uploadErrors = signal<string[]>([]);

  readonly innerSectionRef = viewChild<SponsorDestinationSectionComponent>('innerSectionRef');
  readonly outerSectionRef = viewChild<SponsorDestinationSectionComponent>('outerSectionRef');

  constructor(
    private events_: EventsService,
    private sponsorAds: SponsorAdsService,
    private router: Router
  ) {}

  async ngOnInit() {
    this.loadingEvents.set(true);
    try {
      this.events.set(await this.events_.listEvents());
    } catch {
      this.error.set('Could not load events.');
    } finally {
      this.loadingEvents.set(false);
    }
  }

  private hasUnsavedChanges(): boolean {
    return !!this.innerSectionRef()?.dirty() || !!this.outerSectionRef()?.dirty();
  }

  // Warns on an actual browser tab close/refresh/navigation-away, not just the in-app
  // Back to Dashboard button below (goToDashboard() handles that path explicitly).
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
    }
  }

  goToDashboard() {
    if (this.hasUnsavedChanges()) {
      const leave = window.confirm(
        'You have unsaved changes (uploads, deletions, reordering, or duration edits) that have not been saved. Leave without saving?'
      );
      if (!leave) return;
    }
    this.router.navigateByUrl('/');
  }

  async onEventChange(eventId: string) {
    if (this.hasUnsavedChanges()) {
      const leave = window.confirm('You have unsaved changes. Switch events without saving?');
      if (!leave) return;
    }
    this.selectedEventId.set(eventId || null);
    this.eventDetail.set(null);
    this.selectedTableNumber.set(null);
    this.error.set(null);
    if (!eventId) return;

    this.loadingEventDetail.set(true);
    try {
      const detail = await this.events_.getEvent(eventId);
      this.eventDetail.set(detail);
      if (detail.tables.length > 0) {
        this.onTableChange(String(detail.tables[0].tableNumber));
      }
    } catch {
      this.error.set('Could not load the selected event.');
    } finally {
      this.loadingEventDetail.set(false);
    }
  }

  onTableChange(tableNumber: string) {
    if (this.hasUnsavedChanges()) {
      const leave = window.confirm('You have unsaved changes. Switch tables without saving?');
      if (!leave) return;
    }
    this.selectedTableNumber.set(tableNumber ? Number(tableNumber) : null);
    const table = this.selectedTable;
    // Default to uploading into every destination enabled for this table - normally an ad
    // goes everywhere it can; the user can uncheck one before uploading if not.
    this.uploadToInner = !!table?.innerLed;
    this.uploadToOuter = !!table?.outerLed;
  }

  get selectedTable() {
    const tableNumber = this.selectedTableNumber();
    return this.eventDetail()?.tables.find((t) => t.tableNumber === tableNumber) ?? null;
  }

  get selectedDestinations(): SponsorAdDestination[] {
    const destinations: SponsorAdDestination[] = [];
    if (this.uploadToInner) destinations.push('inner');
    if (this.uploadToOuter) destinations.push('outer');
    return destinations;
  }

  // A stale "Some files were rejected" message from an earlier upload attempt would
  // otherwise linger indefinitely - nothing else clears it. Treat a destination's Save
  // Sequence as the user moving on, and clear it then.
  onSequenceSaved() {
    this.uploadErrors.set([]);
    this.error.set(null);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave() {
    this.dragOver.set(false);
  }

  async onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      await this.upload(Array.from(files));
    }
  }

  async onFileInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      await this.upload(Array.from(input.files));
      input.value = '';
    }
  }

  private async upload(fileList: File[]) {
    const eventId = this.selectedEventId();
    const tableNumber = this.selectedTableNumber();
    const destinations = this.selectedDestinations;
    this.error.set(null);
    this.uploadErrors.set([]);

    if (!eventId || !tableNumber) return;
    if (destinations.length === 0) {
      this.error.set('Select at least one destination (Inner and/or Outer) before uploading.');
      return;
    }

    this.uploading.set(true);
    this.uploadProgress.set(0);
    try {
      // Web BRD Section 14: the same files are copied into every selected destination -
      // each destination gets its own physical copy and its own change-log "New" entry.
      // Appending locally (not reloading) preserves any unsaved edits already made to
      // files already listed in that destination's section.
      const errorsByFile = new Map<string, string>();
      for (const destination of destinations) {
        this.uploadProgress.set(0);
        const { results } = await this.sponsorAds.uploadFiles(
          eventId,
          tableNumber,
          destination,
          fileList,
          (percent) => this.uploadProgress.set(percent)
        );
        const succeeded = results.filter((r) => r.ok).map((r) => r.filename);
        const section = destination === 'inner' ? this.innerSectionRef() : this.outerSectionRef();
        section?.addUploadedFiles(succeeded);
        for (const r of results) {
          if (!r.ok && r.error) errorsByFile.set(r.filename, r.error);
        }
      }
      this.uploadErrors.set([...errorsByFile.entries()].map(([filename, error]) => `${filename}: ${error}`));
    } catch {
      this.error.set('Upload failed. Please try again.');
    } finally {
      this.uploading.set(false);
    }
  }
}
