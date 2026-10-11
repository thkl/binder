import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

/** Builds API URLs from the environment's configured API root. */
@Injectable({ providedIn: 'root' })
export class ApplicationService {
  /**
   * Joins an API version, endpoint, and optional query or path suffix.
   *
   * @param {string} version - API version to include in the URL.
   * @param {string} endpoint - API endpoint path to append to the configured API root.
   * @param {string} optional - Optional path or query suffix appended to the API URL.
   * @returns {string} - Joins an API version, endpoint, and optional query or path suffix.
   */
  getApiUrl(version: string, endpoint: string, optional?: string): string {
    const result = `${environment.apiUrl}/${version}/${endpoint}`;
    return optional ? `${result}${optional}` : result;
  }
}
