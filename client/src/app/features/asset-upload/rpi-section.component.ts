import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, signal } from '@angular/core';
import { RpiService } from '../../core/rpi.service';
import { OvrSlotRowComponent } from './ovr-slot-row.component';

// Web BRD Section 21: RPI Home Look is event-level (the event's single rpi folder) - no
// table/destination dimension at all, unlike every other section on this page. Shown once
// per event, independent of which table is currently selected.
@Component({
  selector: 'app-rpi-section',
  standalone: true,
  imports: [CommonModule, OvrSlotRowComponent],
  templateUrl: './rpi-section.component.html',
})
export class RpiSectionComponent implements OnChanges {
  @Input({ required: true }) eventId!: string;

  readonly slotExists = signal(false);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly uploadFn = (file: File, onProgress: (percent: number) => void) =>
    this.rpi.uploadFile(this.eventId, file, onProgress);
  readonly deleteFn = () => this.rpi.deleteFile(this.eventId);

  constructor(private rpi: RpiService) {}

  ngOnChanges() {
    this.reload();
  }

  async reload() {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const status = await this.rpi.getStatus(this.eventId);
      this.slotExists.set(status.exists);
    } catch {
      this.loadError.set('Could not load RPI Home Look status.');
    } finally {
      this.loading.set(false);
    }
  }

  get previewUrl() {
    return this.rpi.previewUrl(this.eventId);
  }
}
