import { HttpClient } from '@angular/common/http';
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
}

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
}
