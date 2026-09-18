import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { EventSummary, EventsService, ExportEventResponse } from '../../core/events.service';

// Step 6 (Web BRD Section 25): the real Dashboard/Event List, replacing Step 1's
// "You're Signed In" placeholder. Active-status events only, sorted by Event ID
// descending (both already true of GET /api/events - see events/routes.js). The Log tab
// is still a disabled stub (Step 9's scope). Export Event (Step 7, Section 25.3) is now
// real - see exportEvent() below.
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

  constructor(private eventsService: EventsService, public auth: AuthService, private router: Router) {}

  async ngOnInit() {
    try {
      this.events.set(await this.eventsService.listEvents());
    } catch {
      this.error.set('Could not load events.');
    } finally {
      this.loading.set(false);
    }
  }

  // Web BRD Section 25.1: "the Export Event action must not be presented to the Normal
  // User" - hidden entirely in the template via this getter, not just disabled. The real
  // enforcement is server-side (requireRole on POST /api/events/:eventId/export).
  get canExport(): boolean {
    const role = this.auth.currentUser()?.role;
    return role === 'SuperAdmin' || role === 'Administrator';
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
}
