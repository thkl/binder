import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ApiResponse, CalendarEvent, CalendarEventSchema } from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private readonly http = inject(HttpClient);
  private readonly application = inject(ApplicationService);

  async synchronize(documentUuid: string): Promise<CalendarEvent | null> {
    const response = await firstValueFrom(
      this.http.post<ApiResponse<unknown>>(
        this.application.getApiUrl('v1', `calendar/documents/${documentUuid}/sync`),
        {},
        { withCredentials: true },
      ),
    );

    return response.data === null ? null : CalendarEventSchema.parse(response.data);
  }

  errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 409) {
      return 'documents.calendarDisabled';
    }

    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }

    return 'documents.calendarError';
  }
}
