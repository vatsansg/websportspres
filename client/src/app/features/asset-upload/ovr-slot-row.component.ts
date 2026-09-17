import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

// Decoupled from which endpoint it talks to (uploadFn/deleteFn are passed in) so the same
// row UI serves standard OVR triggers, All Sponsor Logo, Default Assets, and the
// event-level RPI slot - all single-file upload/delete/preview, just against different
// backend routes (ovr-triggers.service.ts vs rpi.service.ts).
@Component({
  selector: 'app-ovr-slot-row',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ovr-slot-row.component.html',
  styleUrl: './ovr-slot-row.component.scss',
})
export class OvrSlotRowComponent {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) kind!: 'image' | 'video';
  @Input() optional = false;
  @Input({ required: true }) exists!: boolean;
  @Input() usingFallback = false;
  @Input({ required: true }) previewUrl!: string;
  @Input({ required: true }) uploadFn!: (file: File, onProgress: (percent: number) => void) => Promise<void>;
  @Input({ required: true }) deleteFn!: () => Promise<void>;
  @Output() changed = new EventEmitter<void>();

  readonly uploading = signal(false);
  readonly progress = signal(0);
  readonly error = signal<string | null>(null);
  readonly previewOpen = signal(false);
  // Bumped after every successful upload so the preview <img>/<video> re-fetches the new
  // content instead of showing a browser-cached copy of the old file at the same URL.
  readonly previewVersion = signal(0);

  get accept() {
    return this.kind === 'image' ? '.png' : '.mp4';
  }

  get versionedPreviewUrl() {
    return `${this.previewUrl}?v=${this.previewVersion()}`;
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error.set(null);
    this.uploading.set(true);
    this.progress.set(0);
    try {
      await this.uploadFn(file, (percent) => this.progress.set(percent));
      this.previewVersion.update((v) => v + 1);
      this.changed.emit();
    } catch (err) {
      this.error.set(this.extractError(err));
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }

  togglePreview() {
    this.previewOpen.update((v) => !v);
  }

  async delete() {
    this.error.set(null);
    try {
      await this.deleteFn();
      this.previewOpen.set(false);
      this.changed.emit();
    } catch (err) {
      this.error.set(this.extractError(err));
    }
  }

  private extractError(err: unknown): string {
    const message = (err as { error?: { error?: string } })?.error?.error;
    return message ?? 'That action failed. Please try again.';
  }
}
