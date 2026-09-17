import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, signal } from '@angular/core';
import { OvrDestination, OvrTriggerSlot, OvrTriggersService } from '../../core/ovr-triggers.service';
import { OvrSlotRowComponent } from './ovr-slot-row.component';

// The standard OVR Match Trigger types (plus All Sponsor Logo, where applicable) for one
// destination - excludes the Default Assets slots, which get their own section/placement
// (see default-assets-section.component.ts) since they're conceptually a different
// feature (a fallback source), not a trigger fired during play.
@Component({
  selector: 'app-ovr-trigger-section',
  standalone: true,
  imports: [CommonModule, OvrSlotRowComponent],
  templateUrl: './ovr-trigger-section.component.html',
})
export class OvrTriggerSectionComponent implements OnChanges {
  @Input({ required: true }) eventId!: string;
  @Input({ required: true }) tableNumber!: number;
  @Input({ required: true }) destination!: OvrDestination;
  @Input({ required: true }) label!: string;

  readonly slots = signal<OvrTriggerSlot[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  constructor(private ovrTriggers: OvrTriggersService) {}

  ngOnChanges() {
    this.reload();
  }

  async reload() {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const slots = await this.ovrTriggers.getSlots(this.eventId, this.tableNumber, this.destination);
      this.slots.set(slots.filter((s) => s.triggerId !== 'default'));
    } catch {
      this.loadError.set('Could not load OVR Match Triggers for this destination.');
    } finally {
      this.loading.set(false);
    }
  }

  uploadFnFor(assetKey: string) {
    return (file: File, onProgress: (percent: number) => void) =>
      this.ovrTriggers.uploadAsset(this.eventId, this.tableNumber, this.destination, assetKey, file, onProgress);
  }

  deleteFnFor(assetKey: string) {
    return () => this.ovrTriggers.deleteAsset(this.eventId, this.tableNumber, this.destination, assetKey);
  }

  previewUrlFor(assetKey: string) {
    return this.ovrTriggers.previewUrl(this.eventId, this.tableNumber, this.destination, assetKey);
  }
}
