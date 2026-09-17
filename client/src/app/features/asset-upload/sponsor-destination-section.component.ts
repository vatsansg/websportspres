import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  SponsorAdDestination,
  SponsorAdFile,
  SponsorAdsService,
} from '../../core/sponsor-ads.service';

interface FileRow extends SponsorAdFile {
  isVideo: boolean;
  retrievingDuration: boolean;
}

function isVideoFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.mp4');
}

// Web BRD Section 13: order/duration are managed independently per table/destination -
// this component manages exactly one (table, destination) pair's file list, ordering, and
// Save Sequence action. Uploading is the parent's job (AssetUploadComponent), since Section
// 14 treats "which destination(s) to copy into" as one decision made once per upload
// batch, not a property of a permanently-fixed per-destination zone - reload() is public
// so the parent can refresh this section after a shared upload completes.
@Component({
  selector: 'app-sponsor-destination-section',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sponsor-destination-section.component.html',
  styleUrl: './sponsor-destination-section.component.scss',
})
export class SponsorDestinationSectionComponent implements OnInit {
  @Input({ required: true }) eventId!: string;
  @Input({ required: true }) tableNumber!: number;
  @Input({ required: true }) destination!: SponsorAdDestination;
  @Input({ required: true }) label!: string;

  readonly files = signal<FileRow[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);

  constructor(private sponsorAds: SponsorAdsService) {}

  ngOnInit() {
    this.reload();
  }

  async reload() {
    this.loading.set(true);
    try {
      const files = await this.sponsorAds.listFiles(this.eventId, this.tableNumber, this.destination);
      this.files.set(
        files.map((f) => ({ ...f, isVideo: isVideoFilename(f.filename), retrievingDuration: false }))
      );
    } catch {
      this.error.set('Could not load files for this destination.');
    } finally {
      this.loading.set(false);
    }
  }

  async retrieveDuration(file: FileRow) {
    file.retrievingDuration = true;
    this.files.set([...this.files()]);
    try {
      const duration = await this.sponsorAds.retrieveDuration(
        this.eventId,
        this.tableNumber,
        this.destination,
        file.filename
      );
      file.duration = duration;
    } catch {
      this.error.set(`Could not retrieve duration for "${file.filename}".`);
    } finally {
      file.retrievingDuration = false;
      this.files.set([...this.files()]);
    }
  }

  moveUp(index: number) {
    if (index === 0) return;
    const files = [...this.files()];
    [files[index - 1], files[index]] = [files[index], files[index - 1]];
    this.files.set(files);
  }

  moveDown(index: number) {
    const files = this.files();
    if (index === files.length - 1) return;
    const updated = [...files];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.files.set(updated);
  }

  async deleteFile(file: FileRow) {
    this.error.set(null);
    try {
      await this.sponsorAds.deleteFile(this.eventId, this.tableNumber, this.destination, file.filename);
      await this.reload();
    } catch {
      this.error.set(`Could not delete "${file.filename}".`);
    }
  }

  async saveSequence() {
    this.error.set(null);
    this.saved.set(false);
    this.saving.set(true);
    try {
      await this.sponsorAds.saveSequence(
        this.eventId,
        this.tableNumber,
        this.destination,
        this.files().map((f) => ({ filename: f.filename, duration: f.duration }))
      );
      this.saved.set(true);
      await this.reload();
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 400) {
        this.error.set(err.error?.error ?? 'Could not save the sequence.');
      } else {
        this.error.set('Could not save the sequence. Please try again.');
      }
    } finally {
      this.saving.set(false);
    }
  }
}
