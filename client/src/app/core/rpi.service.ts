import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

// Web BRD Section 21: RPI Home Look is event-level (the event's single rpi folder), not
// per-table - no destination/table dimension anywhere in this service, unlike
// ovr-triggers.service.ts.
@Injectable({ providedIn: 'root' })
export class RpiService {
  constructor(private http: HttpClient) {}

  private basePath(eventId: string) {
    return `/api/events/${encodeURIComponent(eventId)}/ovr-triggers/rpi`;
  }

  async getStatus(eventId: string): Promise<{ exists: boolean }> {
    return firstValueFrom(this.http.get<{ exists: boolean }>(this.basePath(eventId)));
  }

  uploadFile(eventId: string, file: File, onProgress?: (percent: number) => void): Promise<void> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return new Promise((resolve, reject) => {
      this.http
        .post(`${this.basePath(eventId)}/upload`, formData, { reportProgress: true, observe: 'events' })
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              onProgress?.(Math.round((event.loaded / event.total) * 100));
            } else if (event.type === HttpEventType.Response) {
              resolve();
            }
          },
          error: (err) => reject(err),
        });
    });
  }

  async deleteFile(eventId: string): Promise<void> {
    await firstValueFrom(this.http.delete(this.basePath(eventId)));
  }

  previewUrl(eventId: string): string {
    return `${this.basePath(eventId)}/preview`;
  }
}
