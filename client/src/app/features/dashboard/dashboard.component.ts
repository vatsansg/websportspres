import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import {
  EventSummary,
  EventsService,
  ExportEventResponse,
  formatSgt,
  LogEntry,
  MAX_FAVORITES_PER_USER,
} from '../../core/events.service';
import { SettingsService } from '../../core/settings.service';

// Step 6 (Web BRD Section 25): the real Dashboard/Event List, replacing Step 1's
// "You're Signed In" placeholder. Active-status events only, sorted by Event ID
// descending (both already true of GET /api/events - see events/routes.js). Export Event
// (Step 7, Section 25.3) is real - see exportEvent() below. Archive (user-requested,
// 2026-09-18, beyond the BRD's original "reserved for future implementation" scope for
// this field - see workflow.md) is also real - see the archive* methods below. Favorites
// (user-requested, 2026-09-19, max 3 per user, every role) - see
// toggleFavorite()/visibleEvents below. Log (Step 9, Section 30) - see viewLog() below.
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  readonly events = signal<EventSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly exportingEventId = signal<string | null>(null);
  readonly exportError = signal<string | null>(null);
  readonly exportResult = signal<ExportEventResponse | null>(null);
  readonly guidCopied = signal(false);

  // Archive (user-requested, 2026-09-18): a two-phase confirmation, both steps required
  // before the API is ever called. `archivePhase` tracks which of the two prompts is
  // showing for `archivingEvent`; null means no archive flow is in progress.
  readonly archivingEvent = signal<EventSummary | null>(null);
  readonly archivePhase = signal<1 | 2 | null>(null);
  readonly archiving = signal(false);
  readonly archiveError = signal<string | null>(null);

  // Favorites (user-requested, 2026-09-19): max 3 per user, available to every role.
  readonly favoritesOnly = signal(false);
  readonly togglingFavoriteId = signal<string | null>(null);
  readonly favoriteError = signal<string | null>(null);
  readonly maxFavorites = MAX_FAVORITES_PER_USER;

  // Log (Step 9, Web BRD Section 30): `viewingLogEvent` non-null drives the modal; entries
  // load once per open (not cached across events).
  readonly viewingLogEvent = signal<EventSummary | null>(null);
  readonly logEntries = signal<LogEntry[]>([]);
  readonly logLoading = signal(false);
  readonly logError = signal<string | null>(null);

  // User-requested (2026-09-19, see workflow.md): reminds a user at every login (this
  // page is the post-login landing page) of any event with unsent Change Log Email
  // changes - persisted server-side, so this reappears even after the browser was closed
  // without ever pressing Send Mail. Only shown while the global "Force Email Send"
  // System Setting is on.
  readonly forceEmailSend = signal(false);

  constructor(
    private eventsService: EventsService,
    private settingsService: SettingsService,
    public auth: AuthService,
    private router: Router
  ) {}

  async ngOnInit() {
    try {
      this.events.set(await this.eventsService.listEvents());
    } catch {
      this.error.set('Could not load events.');
    } finally {
      this.loading.set(false);
    }

    try {
      const settings = await this.settingsService.getSettings();
      this.forceEmailSend.set(settings.forceEmailSend);
    } catch {
      // Best-effort - the per-row pending indicator still shows regardless; only the
      // reminder banner depends on this setting.
    }
  }

  get pendingEmailEvents(): EventSummary[] {
    return this.events().filter((e) => e.emailPending);
  }

  // Shared by Export Event (Web BRD Section 25.1: "must not be presented to the Normal
  // User") and Archive (user-requested, same role restriction) - hidden entirely in the
  // template via this getter, not just disabled. The real enforcement is server-side
  // (requireRole on both POST .../export and PATCH .../archive).
  get canManageEvents(): boolean {
    const role = this.auth.currentUser()?.role;
    return role === 'SuperAdmin' || role === 'Administrator';
  }

  get visibleEvents(): EventSummary[] {
    const events = this.events();
    return this.favoritesOnly() ? events.filter((e) => e.isFavorite) : events;
  }

  get favoriteCount(): number {
    return this.events().filter((e) => e.isFavorite).length;
  }

  async toggleFavorite(event: EventSummary) {
    this.favoriteError.set(null);
    this.togglingFavoriteId.set(event.eventId);
    try {
      if (event.isFavorite) {
        await this.eventsService.removeFavorite(event.eventId);
      } else {
        if (this.favoriteCount >= this.maxFavorites) {
          this.favoriteError.set(`You can only favorite up to ${this.maxFavorites} events. Remove one first.`);
          return;
        }
        await this.eventsService.addFavorite(event.eventId);
      }
      this.events.update((events) =>
        events.map((e) => (e.eventId === event.eventId ? { ...e, isFavorite: !e.isFavorite } : e))
      );
    } catch (err) {
      this.favoriteError.set(
        err instanceof HttpErrorResponse && err.error?.error
          ? err.error.error
          : 'Could not update favorites. Please try again.'
      );
    } finally {
      this.togglingFavoriteId.set(null);
    }
  }

  ledSummary(event: EventSummary): string {
    return event.tables
      .map((t) => {
        const leds = [t.innerLed && 'Inner', t.outerLed && 'Outer', t.mainLed && 'Main'].filter(Boolean);
        return `Table ${t.tableNumber} (${leds.join('/') || 'none'})`;
      })
      .join(', ');
  }

  uploadAssets(eventId: string) {
    this.router.navigate(['/asset-upload'], { queryParams: { eventId } });
  }

  async exportEvent(event: EventSummary) {
    this.exportError.set(null);
    this.exportingEventId.set(event.eventId);
    try {
      const result = await this.eventsService.exportEvent(event.eventId);
      this.downloadJson(result);
      this.guidCopied.set(false);
      this.exportResult.set(result);
    } catch (err) {
      this.exportError.set(
        err instanceof HttpErrorResponse && err.error?.error
          ? err.error.error
          : 'Could not export this event. Please try again.'
      );
    } finally {
      this.exportingEventId.set(null);
    }
  }

  // Web BRD Section 25.3: "make the JSON available for the user to download to a folder
  // of their choice, using the filename convention {EventID}_{EventName}_assetconfig.json".
  private downloadJson(result: ExportEventResponse) {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${result.eventId}_${result.eventName}_assetconfig.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async copyGuid() {
    const guid = this.exportResult()?.exportGuid;
    if (!guid) return;
    try {
      await navigator.clipboard.writeText(guid);
      this.guidCopied.set(true);
    } catch {
      this.guidCopied.set(false);
    }
  }

  closeExportResult() {
    this.exportResult.set(null);
  }

  // Phase 1: "do you really want to archive - you will not be able to access the event
  // and its files through the UI".
  requestArchive(event: EventSummary) {
    this.archiveError.set(null);
    this.archivingEvent.set(event);
    this.archivePhase.set(1);
  }

  // Phase 2: "you have decided to take off the event from further asset load, do confirm
  // again". Nothing is sent to the server until this second confirmation too.
  confirmArchivePhase1() {
    this.archivePhase.set(2);
  }

  cancelArchive() {
    this.archivingEvent.set(null);
    this.archivePhase.set(null);
  }

  async confirmArchivePhase2() {
    const event = this.archivingEvent();
    if (!event) return;
    this.archiving.set(true);
    this.archiveError.set(null);
    try {
      await this.eventsService.archiveEvent(event.eventId);
      this.cancelArchive();
      // The event no longer matches GET /api/events' Active-only filter, so a full
      // reload is simplest and guarantees the list matches the server exactly.
      this.events.set(await this.eventsService.listEvents());
    } catch (err) {
      this.archiveError.set(
        err instanceof HttpErrorResponse && err.error?.error
          ? err.error.error
          : 'Could not archive this event. Please try again.'
      );
    } finally {
      this.archiving.set(false);
    }
  }

  // Web BRD Section 30: Event Log Tab. Available to every role (no canManageEvents gate) -
  // matches the server-side route, which also has no requireRole.
  async viewLog(event: EventSummary) {
    this.viewingLogEvent.set(event);
    this.logError.set(null);
    this.logLoading.set(true);
    try {
      this.logEntries.set(await this.eventsService.getEventLog(event.eventId));
    } catch {
      this.logError.set('Could not load the change log for this event. Please try again.');
    } finally {
      this.logLoading.set(false);
    }
  }

  closeLog() {
    this.viewingLogEvent.set(null);
    this.logEntries.set([]);
    this.logError.set(null);
  }

  formatSgt(iso: string): string {
    return formatSgt(iso);
  }
}
