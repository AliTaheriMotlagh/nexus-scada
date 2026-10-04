import { useSession } from '../stores/session.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly issues?: string[];
  constructor(message: string, status: number, issues?: string[]) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = useSession.getState().token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (typeof body === 'string') {
      headers['content-type'] = 'text/plain';
      payload = body;
    } else {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(`/api${url}`, { method, headers, body: payload });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && token) useSession.getState().logout();
    const err = data as { error?: string; issues?: string[] };
    throw new ApiError(err?.error ?? res.statusText, res.status, err?.issues);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');
