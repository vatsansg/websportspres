import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface TableConfig {
  tableNumber: number;
  innerLed: boolean;
  outerLed: boolean;
  mainLed: boolean;
}

export interface CreateEventRequest {
  eventId: string;
  eventName: string;
  year: number;
  tables: TableConfig[];
}

export interface CreateEventResponse {
  eventId: string;
  eventName: string;
  year: number;
  eventStorageUrl: string;
}

export interface EventSummary {
  eventId: string;
  eventName: string;
  year: number;
  status: 'Active' | 'Archive';
  tables: TableConfig[];
  isFavorite: boolean;
}

export const MAX_FAVORITES_PER_USER = 3;

export interface EventTable extends TableConfig {
  innerResolutionWidth: number;
  innerResolutionHeight: number;
  outerResolutionWidth: number;
  outerResolutionHeight: number;
  mainResolutionWidth: number;
  mainResolutionHeight: number;
}

export interface EventDetail {
  eventId: string;
  eventName: string;
  year: number;
  status: 'Active' | 'Archive';
  tables: EventTable[];
}

export interface EditEventRequest {
  eventId: string;
  eventName: string;
  year: number;
  tables: TableConfig[];
  confirmed?: boolean;
}

export interface EditConfirmation {
  type: 'rename' | 'table-delete' | 'destination-disable';
  tableNumber?: number;
  destination?: 'inner' | 'outer' | 'main';
  message: string;
  fileCount: number;
}

// Thrown by updateEvent() when the server responds 409 with a list of destructive
// changes the caller must show the user before resubmitting with `confirmed: true`
// (Web BRD Section 8 - "if files already exist ... the user must receive a confirmation
// prompt").
export class ConfirmationRequiredError extends Error {
  constructor(public confirmations: EditConfirmation[]) {
    super('Confirmation required');
  }
}

// Web BRD Section 25.4's exact field list/casing - this is parsed by a downstream,
// non-Angular consumer, so these names are the spec, not a stylistic choice.
export interface ExportEventResponse {
  eventId: string;
  eventName: string;
  eventStorageUrl: string;
  tables: TableConfig[];
  exportedByUsername: string;
  exportedByRole: string;
  exportTimestamp: string;
  exportGuid: string;
}

@Injectable({ providedIn: 'root' })
export class EventsService {
  constructor(private http: HttpClient) {}

  async createEvent(request: CreateEventRequest): Promise<CreateEventResponse> {
    return firstValueFrom(this.http.post<CreateEventResponse>('/api/events', request));
  }

  async listEvents(): Promise<EventSummary[]> {
    return firstValueFrom(this.http.get<EventSummary[]>('/api/events'));
  }

  async getEvent(eventId: string): Promise<EventDetail> {
    return firstValueFrom(this.http.get<EventDetail>(`/api/events/${encodeURIComponent(eventId)}`));
  }

  // Web BRD Section 8/9: combined edit endpoint. Currently-known event ID is the URL
  // param (`currentEventId`); the body's own `eventId` carries the *new* ID, which may
  // be unchanged. Throws ConfirmationRequiredError on a 409 "confirmation required"
  // response rather than a generic HttpErrorResponse, so callers can branch cleanly.
  async updateEvent(currentEventId: string, request: EditEventRequest): Promise<CreateEventResponse> {
    try {
      return await firstValueFrom(
        this.http.put<CreateEventResponse>(`/api/events/${encodeURIComponent(currentEventId)}`, request)
      );
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 409 && err.error?.confirmations) {
        throw new ConfirmationRequiredError(err.error.confirmations as EditConfirmation[]);
      }
      throw err;
    }
  }

  // Web BRD Section 25.3: generates a new ExportGUID, writes _GUID.json to the event's
  // storage folder server-side, and returns the same content for the caller to trigger a
  // local download from.
  async exportEvent(eventId: string): Promise<ExportEventResponse> {
    return firstValueFrom(
      this.http.post<ExportEventResponse>(`/api/events/${encodeURIComponent(eventId)}/export`, {})
    );
  }

  // User-requested (2026-09-18): moves an event to Archive status - it then drops out of
  // the Active-only Dashboard list. No unarchive action exists yet (not requested).
  async archiveEvent(eventId: string): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/events/${encodeURIComponent(eventId)}/archive`, {}));
  }

  // User-requested (2026-09-19): per-user favorites, max 3, available to every role.
  async addFavorite(eventId: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/events/${encodeURIComponent(eventId)}/favorite`, {}));
  }

  async removeFavorite(eventId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/events/${encodeURIComponent(eventId)}/favorite`));
  }
}
