import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ApiResponse,
  DocumentAuditQuerySchema,
  DocumentAuditResponse,
  DocumentAuditResponseSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ApplicationService } from '../../../common/application.service';

@Injectable({ providedIn: 'root' })
export class DocumentAuditService {
  private readonly http = inject(HttpClient);
  private readonly application = inject(ApplicationService);

  async load(documentUuid: string, page = 1, pageSize = 25): Promise<DocumentAuditResponse> {
    const query = DocumentAuditQuerySchema.parse({ page, pageSize });
    const params = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
    });
    const response = await firstValueFrom(
      this.http.get<ApiResponse<unknown>>(
        this.application.getApiUrl('v1', `documents/${documentUuid}/audit`, `?${params}`),
        { withCredentials: true },
      ),
    );
    return DocumentAuditResponseSchema.parse(response.data);
  }

  errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return 'The document history could not be loaded.';
  }
}
