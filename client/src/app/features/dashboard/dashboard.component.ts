import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { EventSummary, EventsService } from '../../core/events.service';

// Step 6 (Web BRD Section 25): the real Dashboard/Event List, replacing Step 1's
// "You're Signed In" placeholder. Active-status events only, sorted by Event ID
// descending (both already true of GET /api/events - see events/routes.js). Export
// Event (Super Admin/Admin only, Section 2.1) and the Log tab are deliberately stubbed
// disabled here - Export is Step 7's scope and the Log tab is Step 9's, both kept out of
// this step's boundary rather than built early.
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
}
