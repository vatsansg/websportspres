import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type OvrDestination = 'inner' | 'outer' | 'main';

export interface OvrTriggerSlot {
  assetKey: string;
  triggerId: string;
  label: string;
  kind: 'image' | 'video';
  optional: boolean;
  exists: boolean;
  usingFallback: boolean;
}

@Injectable({ providedIn: 'root' })
export class OvrTriggersService {
  constructor(private http: HttpClient) {}

  private basePath(eventId: string, tableNumber: number, destination: OvrDestination) {
    return `/api/events/${encodeURIComponent(eventId)}/tables/${tableNumber}/ovr-triggers/${destination}`;
  }

  async getSlots(eventId: string, tableNumber: number, destination: OvrDestination): Promise<OvrTriggerSlot[]> {
    const res = await firstValueFrom(
      this.http.get<{ slots: OvrTriggerSlot[] }>(this.basePath(eventId, tableNumber, destination))
    );
    return res.slots;
  }

  uploadAsset(
    eventId: string,
    tableNumber: number,
    destination: OvrDestination,
    assetKey: string,
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return new Promise((resolve, reject) => {
      this.http
        .post(`${this.basePath(eventId, tableNumber, destination)}/${assetKey}/upload`, formData, {
          reportProgress: true,
          observe: 'events',
        })
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

  async deleteAsset(
    eventId: string,
    tableNumber: number,
    destination: OvrDestination,
    assetKey: string
  ): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.basePath(eventId, tableNumber, destination)}/${assetKey}`));
  }

  previewUrl(eventId: string, tableNumber: number, destination: OvrDestination, assetKey: string): string {
    return `${this.basePath(eventId, tableNumber, destination)}/${assetKey}/preview`;
  }
}
