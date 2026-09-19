import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, HostListener, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EventDetail, EventSummary, EventsService, SendChangeLogEmailScope } from '../../core/events.service';
import { SettingsService } from '../../core/settings.service';
import { SponsorAdDestination, SponsorAdsService } from '../../core/sponsor-ads.service';
import { SponsorDestinationSectionComponent } from './sponsor-destination-section.component';
import { OvrTriggerSectionComponent } from './ovr-trigger-section.component';
import { DefaultAssetsSectionComponent } from './default-assets-section.component';
import { RpiSectionComponent } from './rpi-section.component';
import { AssetRulesModalComponent } from './asset-rules-modal.component';

// Web BRD Section 10: the Asset Upload page has two tabs, Sponsor Ads and OVR Match
// Triggers.
@Component({
  selector: 'app-asset-upload',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SponsorDestinationSectionComponent,
    OvrTriggerSectionComponent,
    DefaultAssetsSectionComponent,
    RpiSectionComponent,
    AssetRulesModalComponent,
  ],
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
  readonly activeTab = signal<'sponsor' | 'ovr'>('sponsor');
  readonly rulesModalOpen = signal(false);

  // User-requested (2026-09-19, see workflow.md): the Event picker gets the same
  // Favorites filter as the Dashboard, plus pattern search by Event ID or name (e.g.
  // typing "1000" or "Star Contender" narrows the list either within favorites, if that
  // filter is on, or across every active event otherwise). First built as a search box
  // narrowing a plain native <select> - user feedback was that typing appeared to do
  // nothing, since nothing was visible until the separate <select> was opened by hand.
  // Rebuilt as a real combobox (same pattern as User Management's directory search):
  // the filtered list renders directly under the input as you type/focus, click to pick.
  readonly favoritesOnly = signal(false);
  readonly eventSearchQuery = signal('');
  readonly eventListOpen = signal(false);

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

  // User-requested (2026-09-19, see workflow.md): replaces the old automatic per-save
  // Change Log Email with a manual "Send Mail" button, red whenever the selected event
  // has unsent change-log entries. `forceEmailSend` mirrors the global System Settings
  // toggle - when true, leaving this page (any way - Back to Dashboard, a left-nav link,
  // Sign Out, browser close) with unsent changes prompts the user first; see
  // canDeactivateEmailPending() and unsent-email.guard.ts.
  readonly forceEmailSend = signal(true);
  readonly sendingMail = signal(false);
  readonly sendMailError = signal<string | null>(null);
  readonly showEmailPendingPrompt = signal(false);
  private deactivateResolver: ((allow: boolean) => void) | null = null;

  // User feedback (2026-09-19, see workflow.md): sending unconditionally batched every
  // unsent entry ever logged for the event, which in practice was "too many emails...
  // difficult to keep track" - the Send Mail button now opens a scope picker instead of
  // sending immediately. The exit-warning modal (resolveDeactivate('send') above) always
  // uses 'all' directly, skipping this picker - that flow's whole point is "make sure
  // everything outstanding gets sent before you leave," not a quick recap.
  readonly showSendMailOptions = signal(false);
  selectedSendMailScope: SendChangeLogEmailScope = 'session';

  constructor(
    private events_: EventsService,
    private sponsorAds: SponsorAdsService,
    private settings: SettingsService,
    private router: Router,
    private route: ActivatedRoute
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

    try {
      const current = await this.settings.getSettings();
      this.forceEmailSend.set(current.forceEmailSend);
    } catch {
      // Best-effort: if System Settings can't be loaded, default (true, set above) errs
      // on the side of still warning the user rather than silently going quiet.
    }

    // Web BRD Section 25.2: the Dashboard's "Upload Assets" shortcut pre-selects the
    // event it was launched from, instead of landing on an empty picker.
    const preselectedEventId = this.route.snapshot.queryParamMap.get('eventId');
    const preselected = this.events().find((e) => e.eventId === preselectedEventId);
    if (preselected) {
      this.eventSearchQuery.set(this.eventLabel(preselected));
      await this.onEventChange(preselected.eventId);
    }
  }

  private hasUnsavedChanges(): boolean {
    return !!this.innerSectionRef()?.dirty() || !!this.outerSectionRef()?.dirty();
  }

  get selectedEventSummary(): EventSummary | null {
    return this.events().find((e) => e.eventId === this.selectedEventId()) ?? null;
  }

  get filteredEvents(): EventSummary[] {
    let list = this.events();
    if (this.favoritesOnly()) {
      list = list.filter((e) => e.isFavorite);
    }
    const query = this.eventSearchQuery().trim().toLowerCase();
    if (query) {
      list = list.filter(
        (e) => e.eventId.toLowerCase().includes(query) || e.eventName.toLowerCase().includes(query)
      );
    }
    return list;
  }

  private eventLabel(event: EventSummary): string {
    return `${event.eventId} - ${event.eventName}`;
  }

  onEventSearchInput(value: string) {
    this.eventSearchQuery.set(value);
    this.eventListOpen.set(true);
  }

  openEventList() {
    this.eventListOpen.set(true);
  }

  async pickEvent(event: EventSummary) {
    this.eventListOpen.set(false);
    this.eventSearchQuery.set(this.eventLabel(event));
    await this.onEventChange(event.eventId);
  }

  // Best-effort refresh of the selected event's unsent-changes state, called after every
  // natural checkpoint on this page (upload, sequence save, tab/table/event switch) - and
  // authoritatively re-checked again in canDeactivateEmailPending() before ever deciding
  // whether to warn, so a stale read here can only ever make the Send Mail button's color
  // lag briefly, never make the actual exit-guard/decision wrong.
  private async refreshEmailPending() {
    try {
      this.events.set(await this.events_.listEvents());
    } catch {
      // Cosmetic only - see comment above.
    }
  }

  // User-requested (2026-09-19): a successful send resets the pending indicator
  // regardless of which scope was chosen - matches the server route's own behavior.
  async sendMail(scope: SendChangeLogEmailScope): Promise<boolean> {
    const eventId = this.selectedEventId();
    if (!eventId) return true;
    this.sendingMail.set(true);
    this.sendMailError.set(null);
    try {
      await this.events_.sendChangeLogEmail(eventId, scope);
      this.events.update((events) =>
        events.map((e) => (e.eventId === eventId ? { ...e, emailPending: false } : e))
      );
      return true;
    } catch (err) {
      this.sendMailError.set(
        err instanceof HttpErrorResponse && err.error?.error
          ? err.error.error
          : 'Could not send the Change Log Email. Please try again.'
      );
      return false;
    } finally {
      this.sendingMail.set(false);
    }
  }

  openSendMailOptions() {
    this.sendMailError.set(null);
    this.selectedSendMailScope = 'session';
    this.showSendMailOptions.set(true);
  }

  cancelSendMailOptions() {
    this.showSendMailOptions.set(false);
  }

  async confirmSendMailOptions() {
    const ok = await this.sendMail(this.selectedSendMailScope);
    if (ok) {
      this.showSendMailOptions.set(false);
    }
  }

  // Angular Router CanDeactivate hook (see unsent-email.guard.ts) - runs for every way of
  // leaving this route: the Back to Dashboard button, a left-nav link, Sign Out, browser
  // back/forward.
  async canDeactivateEmailPending(): Promise<boolean> {
    await this.refreshEmailPending();
    if (!this.forceEmailSend() || !this.selectedEventSummary?.emailPending) {
      return true;
    }
    this.showEmailPendingPrompt.set(true);
    return new Promise<boolean>((resolve) => {
      this.deactivateResolver = resolve;
    });
  }

  async resolveDeactivate(choice: 'send' | 'leave' | 'cancel') {
    const resolver = this.deactivateResolver;
    if (!resolver) return;

    if (choice === 'cancel') {
      this.showEmailPendingPrompt.set(false);
      this.deactivateResolver = null;
      resolver(false);
      return;
    }
    if (choice === 'leave') {
      this.showEmailPendingPrompt.set(false);
      this.deactivateResolver = null;
      resolver(true);
      return;
    }

    // Always 'all' here (never the scope picker) - leaving the page with unsent changes
    // needs the version guaranteed to cover everything outstanding.
    const ok = await this.sendMail('all');
    if (ok) {
      this.showEmailPendingPrompt.set(false);
      this.deactivateResolver = null;
      resolver(true);
    }
    // On failure, leave the prompt open (with sendMailError() now set) so the user can
    // retry Send Mail Now or fall back to Leave Without Sending/Cancel.
  }

  // Warns on an actual browser tab close/refresh, not just the in-app navigation paths
  // above (those go through canDeactivateEmailPending() via the Router). This native
  // browser prompt is the one unavoidable exception to this app's usual "no native
  // dialogs" convention - there is no way to show a custom in-page modal for a tab close,
  // the browser only honors its own beforeunload prompt.
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.hasUnsavedChanges() || (this.forceEmailSend() && !!this.selectedEventSummary?.emailPending)) {
      event.preventDefault();
    }
  }

  async setTab(tab: 'sponsor' | 'ovr') {
    if (tab === this.activeTab()) return;
    // Switching away from Sponsor Ads unmounts its sections (they're behind an @if per
    // tab), which would silently discard any unsaved reordering/duration edits there.
    if (this.activeTab() === 'sponsor' && this.hasUnsavedChanges()) {
      const leave = window.confirm('You have unsaved changes on the Sponsor Ads tab. Switch tabs without saving?');
      if (!leave) return;
    }
    this.activeTab.set(tab);
    // A tab may hold OVR Trigger/RPI/Default Assets edits this page has no other
    // checkpoint for (see canDeactivateEmailPending()'s comment) - catch those here too.
    await this.refreshEmailPending();
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

  async onTableChange(tableNumber: string) {
    if (this.hasUnsavedChanges()) {
      const leave = window.confirm('You have unsaved changes. Switch tables without saving?');
      if (!leave) return;
    }
    await this.refreshEmailPending();
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
  async onSequenceSaved() {
    this.uploadErrors.set([]);
    this.error.set(null);
    await this.refreshEmailPending();
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
      await this.refreshEmailPending();
    } catch {
      this.error.set('Upload failed. Please try again.');
    } finally {
      this.uploading.set(false);
    }
  }
}
