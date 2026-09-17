import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, signal } from '@angular/core';
import { OvrDestination, OvrTriggerSlot, OvrTriggersService } from '../../core/ovr-triggers.service';
import { OvrSlotRowComponent } from './ovr-slot-row.component';

// Step 4 "Default Assets" feature (per the user's explicit decision, see workflow.md):
// one PNG + one MP4 slot per (table, destination), always saved as default.png/default.mp4,
// used as the Winning Moment fallback source and copied into Home Look's default image.
// Placed on the Sponsor Ads tab for Inner/Outer, and on the OVR Match Triggers tab for
// Main LED (Main has no presence on the Sponsor Ads tab at all) - my own interpretation of
// the user's answer, flagged in workflow.md for correction if wrong. Both placements use
// this same component; only the assetKeys it filters for (triggerId === 'default') come
// from the shared ovr-triggers endpoint regardless of which tab it's rendered on.
@Component({
  selector: 'app-default-assets-section',
  standalone: true,
  imports: [CommonModule, OvrSlotRowComponent],
  templateUrl: './default-assets-section.component.html',
})
export class DefaultAssetsSectionComponent implements OnChanges {
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
      this.slots.set(slots.filter((s) => s.triggerId === 'default'));
    } catch {
      this.loadError.set('Could not load default assets for this destination.');
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
