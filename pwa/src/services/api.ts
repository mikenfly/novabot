import { getToken } from './auth';
import type { ApiError } from '../types/api';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.error);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, { ...options, headers });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      error: `HTTP ${response.status}`,
    }))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }

  return response.json() as Promise<T>;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body: body != null ? JSON.stringify(body) : undefined,
    });
  },

  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  delete<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'DELETE',
      body: body != null ? JSON.stringify(body) : undefined,
    });
  },

  /** Upload raw binary data (e.g. audio blob). Content-Type set by caller. */
  async uploadBlob<T>(path: string, blob: Blob, contentType: string): Promise<T> {
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(path, {
      method: 'POST',
      headers,
      body: blob,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as ApiError;
      throw new ApiRequestError(response.status, body);
    }

    return response.json() as Promise<T>;
  },
};
