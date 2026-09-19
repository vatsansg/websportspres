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
  emailPending: boolean;
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
  emailPending: boolean;
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

// Web BRD Section 30's exact field list - the Event Log Tab reads straight from the same
// CSV Section 24/29 already write (see readChangeLogEntries() in assetChangeLog.js).
export interface LogEntry {
  sno: number;
  filename: string;
  changetimestamp: string;
  status: 'New' | 'Updated' | 'Deleted';
  username: string;
}

export interface EventLogResponse {
  entries: LogEntry[];
}

// User feedback (2026-09-19, see workflow.md): "all" batches every unsent change-log
// entry with no time filter (the original, default behavior) and is the only scope that
// clears the pending indicator; "session"/"24h" are narrower recaps that never mark
// anything as sent, so a genuinely-unsent older entry outside the window is never lost.
export type SendChangeLogEmailScope = 'session' | '24h' | 'all';

export interface SendChangeLogEmailResponse {
  sent: boolean;
  entriesSent?: number;
  scope?: SendChangeLogEmailScope;
  message?: string;
}

// User-requested (2026-09-19, see workflow.md): every timestamp shown to a person is in
// Singapore time (WTT's own timezone), formatted dd/mm/yyyy hh:mm - not the raw UTC ISO
// string the server stores/returns. Shared by the Event Log Tab (dashboard) and anywhere
// else a change-log timestamp is displayed.
export function formatSgt(isoString: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoString));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')} SGT`;
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

  // Web BRD Section 30: Event Log Tab. Already sorted newest-first by the server.
  async getEventLog(eventId: string): Promise<LogEntry[]> {
    const response = await firstValueFrom(
      this.http.get<EventLogResponse>(`/api/events/${encodeURIComponent(eventId)}/log`)
    );
    return response.entries;
  }

  // User-requested (2026-09-19, see workflow.md): manually triggered "Send Mail" -
  // `scope` narrows what gets batched into the one email (see SendChangeLogEmailScope).
  async sendChangeLogEmail(
    eventId: string,
    scope: SendChangeLogEmailScope = 'all'
  ): Promise<SendChangeLogEmailResponse> {
    return firstValueFrom(
      this.http.post<SendChangeLogEmailResponse>(
        `/api/events/${encodeURIComponent(eventId)}/send-change-log-email`,
        { scope }
      )
    );
  }
}
