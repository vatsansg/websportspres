import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EventDetail, EventSummary, EventsService } from '../../core/events.service';
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

  constructor(private events_: EventsService) {}

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

  async onEventChange(eventId: string) {
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
        this.selectedTableNumber.set(detail.tables[0].tableNumber);
      }
    } catch {
      this.error.set('Could not load the selected event.');
    } finally {
      this.loadingEventDetail.set(false);
    }
  }

  onTableChange(tableNumber: string) {
    this.selectedTableNumber.set(tableNumber ? Number(tableNumber) : null);
  }

  get selectedTable() {
    const tableNumber = this.selectedTableNumber();
    return this.eventDetail()?.tables.find((t) => t.tableNumber === tableNumber) ?? null;
  }
}
