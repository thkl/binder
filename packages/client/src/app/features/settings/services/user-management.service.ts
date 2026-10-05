import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
  ApiResponse,
  CreateManagedUserInput,
  CreateManagedUserInputSchema,
  ManagedUser,
  ManagedUserListResponseSchema,
  ManagedUserResponseSchema,
  ResetManagedUserPasswordInput,
  ResetManagedUserPasswordInputSchema,
  UpdateManagedUserInput,
  UpdateManagedUserInputSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { ZodError } from 'zod';

@Injectable({ providedIn: 'root' })
export class UserManagementService {
  readonly users = signal<ManagedUser[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor(private readonly http: HttpClient) {}

  async load(): Promise<ManagedUser[]> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>('/api/v1/auth/users/managed', {
          withCredentials: true,
        }),
      );
      const users = ManagedUserListResponseSchema.parse(response.data).items;
      this.users.set(users);
      return users;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return [];
    } finally {
      this.loading.set(false);
    }
  }

  async create(input: CreateManagedUserInput): Promise<ManagedUser | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          '/api/v1/auth/users',
          CreateManagedUserInputSchema.parse(input),
          { withCredentials: true },
        ),
      );
      const user = ManagedUserResponseSchema.parse(response.data).user;
      this.users.update((users) => [...users, user].sort(this.sortUsers));
      return user;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  async update(uuid: string, input: UpdateManagedUserInput): Promise<ManagedUser | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.patch<ApiResponse<unknown>>(
          `/api/v1/auth/users/${uuid}`,
          UpdateManagedUserInputSchema.parse(input),
          { withCredentials: true },
        ),
      );
      const user = ManagedUserResponseSchema.parse(response.data).user;
      this.users.update((users) =>
        users.map((current) => (current.uuid === user.uuid ? user : current)).sort(this.sortUsers),
      );
      return user;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  async resetPassword(
    uuid: string,
    input: ResetManagedUserPasswordInput,
  ): Promise<ManagedUser | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          `/api/v1/auth/users/${uuid}/password`,
          ResetManagedUserPasswordInputSchema.parse(input),
          { withCredentials: true },
        ),
      );
      const user = ManagedUserResponseSchema.parse(response.data).user;
      this.users.update((users) =>
        users.map((current) => (current.uuid === user.uuid ? user : current)),
      );
      return user;
    } catch (error) {
      this.error.set(this.getErrorMessage(error));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  private sortUsers(left: ManagedUser, right: ManagedUser): number {
    return left.username.localeCompare(right.username);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof ZodError) {
      return error.issues[0]?.message ?? 'Please check the entered user details.';
    }
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return 'Administrator access is required.';
    }
    return 'The users could not be updated. Please try again.';
  }
}
