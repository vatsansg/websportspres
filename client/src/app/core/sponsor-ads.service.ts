import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type SponsorAdDestination = 'inner' | 'outer';

export interface SponsorAdFile {
  filename: string;
  duration: number | null;
  seqno: number | null;
}

export interface SponsorAdUploadResult {
  filename: string;
  ok: boolean;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class SponsorAdsService {
  constructor(private http: HttpClient) {}

  private basePath(eventId: string, tableNumber: number, destination: SponsorAdDestination) {
    return `/api/events/${encodeURIComponent(eventId)}/tables/${tableNumber}/sponsor-ads/${destination}`;
  }

  async listFiles(
    eventId: string,
    tableNumber: number,
    destination: SponsorAdDestination
  ): Promise<SponsorAdFile[]> {
    return firstValueFrom(this.http.get<SponsorAdFile[]>(this.basePath(eventId, tableNumber, destination)));
  }

  uploadFiles(
    eventId: string,
    tableNumber: number,
    destination: SponsorAdDestination,
    files: File[],
    onProgress?: (percent: number) => void
  ): Promise<{ results: SponsorAdUploadResult[] }> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file, file.name);
    }
    return new Promise((resolve, reject) => {
      this.http
        .post<{ results: SponsorAdUploadResult[] }>(
          `${this.basePath(eventId, tableNumber, destination)}/upload`,
          formData,
          { reportProgress: true, observe: 'events' }
        )
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              onProgress?.(Math.round((event.loaded / event.total) * 100));
            } else if (event.type === HttpEventType.Response) {
              resolve(event.body as { results: SponsorAdUploadResult[] });
            }
          },
          error: (err) => reject(err),
        });
    });
  }

  async saveSequence(
    eventId: string,
    tableNumber: number,
    destination: SponsorAdDestination,
    files: Array<{ filename: string; duration: number | null }>
  ): Promise<void> {
    await firstValueFrom(
      this.http.put(`${this.basePath(eventId, tableNumber, destination)}/sequence`, { files })
    );
  }

  async deleteFile(
    eventId: string,
    tableNumber: number,
    destination: SponsorAdDestination,
    filename: string
  ): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${this.basePath(eventId, tableNumber, destination)}/${encodeURIComponent(filename)}`)
    );
  }

  async retrieveDuration(
    eventId: string,
    tableNumber: number,
    destination: SponsorAdDestination,
    filename: string
  ): Promise<number> {
    const response = await firstValueFrom(
      this.http.post<{ durationSeconds: number }>(
        `${this.basePath(eventId, tableNumber, destination)}/${encodeURIComponent(filename)}/duration`,
        {}
      )
    );
    return response.durationSeconds;
  }
}
