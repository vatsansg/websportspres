import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CreateEventResponse, EventsService, TableConfig } from '../../core/events.service';

const EVENT_ID_PATTERN = /^[0-9]+$/;

// Web BRD Section 5/9: every event starts with Table 1, which can never be removed here.
// Additional tables can be added/removed freely before creation - Step 4's asset
// management flow is where table config becomes editable after the fact.
function newTable(tableNumber: number): TableConfig {
  return { tableNumber, innerLed: true, outerLed: false, mainLed: false };
}

@Component({
  selector: 'app-create-event',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './create-event.component.html',
  styleUrl: './create-event.component.scss',
})
export class CreateEventComponent {
  eventId = '';
  eventName = '';
  year = new Date().getFullYear();
  tables: TableConfig[] = [newTable(1)];

  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly createdEvent = signal<CreateEventResponse | null>(null);

  constructor(private events: EventsService, private router: Router) {}

  addTable() {
    const nextNumber = Math.max(...this.tables.map((t) => t.tableNumber)) + 1;
    this.tables.push(newTable(nextNumber));
  }

  removeTable(tableNumber: number) {
    if (tableNumber === 1) return; // Table 1 is mandatory (Section 9).
    this.tables = this.tables.filter((t) => t.tableNumber !== tableNumber);
  }

  // Outer LED can never be selected without Inner (post-004 fix - see
  // db/migrations/004_fix_outer_led_constraint.sql). Keep the checkbox state
  // consistent as the user toggles it rather than only catching it on submit.
  onInnerToggle(table: TableConfig) {
    if (!table.innerLed) {
      table.outerLed = false;
    }
  }

  private validate(): string | null {
    if (!this.eventId.trim()) return 'Event ID is required.';
    if (!EVENT_ID_PATTERN.test(this.eventId.trim())) return 'Event ID must be numeric.';
    if (/wtt/i.test(this.eventName)) return 'Event Name must not contain "WTT".';
    if (!this.eventName.trim()) return 'Event Name is required.';
    for (const table of this.tables) {
      if (!table.innerLed && !table.outerLed && !table.mainLed) {
        return `Table ${table.tableNumber}: select at least one LED type.`;
      }
    }
    return null;
  }

  async submit() {
    this.error.set(null);
    const validationError = this.validate();
    if (validationError) {
      this.error.set(validationError);
      return;
    }

    this.loading.set(true);
    try {
      const created = await this.events.createEvent({
        eventId: this.eventId.trim(),
        eventName: this.eventName.trim(),
        year: this.year,
        tables: this.tables,
      });
      this.createdEvent.set(created);
    } catch (err) {
      if (err instanceof HttpErrorResponse) {
        if (err.status === 409) {
          this.error.set(`Event ID "${this.eventId}" already exists - choose a different one.`);
        } else if (err.status === 400) {
          const details = err.error?.details;
          this.error.set(
            Array.isArray(details) && details.length > 0
              ? String(details[0].msg ?? details[0])
              : 'Please check the event details and try again.'
          );
        } else {
          this.error.set('Could not create the event. Please try again.');
        }
      } else {
        this.error.set('Could not create the event. Please try again.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  cancel() {
    this.router.navigateByUrl('/');
  }

  goToDashboard() {
    this.router.navigateByUrl('/');
  }

  createAnother() {
    this.createdEvent.set(null);
    this.eventId = '';
    this.eventName = '';
    this.year = new Date().getFullYear();
    this.tables = [newTable(1)];
  }
}
