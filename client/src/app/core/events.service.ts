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

@Injectable({ providedIn: 'root' })
export class EventsService {
  constructor(private http: HttpClient) {}

  async createEvent(request: CreateEventRequest): Promise<CreateEventResponse> {
    return firstValueFrom(this.http.post<CreateEventResponse>('/api/events', request));
  }
}
