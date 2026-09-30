import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CsrfService {
  readonly token = signal<string | null>(null);

  setToken(token: string | null): void {
    this.token.set(token);
  }

  clear(): void {
    this.token.set(null);
  }
}
