import { storage } from '@/lib/storage';
import Constants from 'expo-constants';

const KEY_SERVER = 'amora.server';
const KEY_SESSION = 'amora.session';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

interface Session {
  accessToken: string;
  refreshToken: string;
}

let serverUrl: string = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? '';
let session: Session | null = null;
let refreshing: Promise<boolean> | null = null;
const logoutListeners = new Set<() => void>();

export async function loadStoredState() {
  const [server, stored] = await Promise.all([
    storage.get(KEY_SERVER),
    storage.get(KEY_SESSION),
  ]);
  if (server) serverUrl = server;
  session = stored ? (JSON.parse(stored) as Session) : null;
  return { hasSession: !!session };
}

export function getServerUrl() {
  return serverUrl;
}

export async function setServerUrl(url: string) {
  serverUrl = url.trim().replace(/\/+$/, '');
  await storage.set(KEY_SERVER, serverUrl);
}

export function getAccessToken() {
  return session?.accessToken ?? null;
}

export async function setSession(next: Session | null) {
  session = next;
  if (next) await storage.set(KEY_SESSION, JSON.stringify(next));
  else await storage.remove(KEY_SESSION);
}

export function onForcedLogout(fn: () => void) {
  logoutListeners.add(fn);
  return () => {
    logoutListeners.delete(fn);
  };
}

async function refreshSession(): Promise<boolean> {
  if (!session) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${serverUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session!.refreshToken }),
      });
      if (!res.ok) throw new Error('refresh gagal');
      const data = (await res.json()) as Session;
      await setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch {
      await setSession(null);
      logoutListeners.forEach((fn) => fn());
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

type Body = Record<string, unknown> | FormData | undefined;

async function request<T>(method: string, path: string, body?: Body, retry = true): Promise<T> {
  if (!serverUrl) throw new ApiError(0, 'NO_SERVER', 'Alamat server belum diatur');
  const headers: Record<string, string> = {};
  if (session) headers.authorization = `Bearer ${session.accessToken}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`${serverUrl}${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Tidak bisa terhubung ke server. Periksa internet atau alamat server.');
  }

  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;

  const code: string = data?.error?.code ?? 'ERROR';
  if (code === 'ACCOUNT_DELETED' && session) {
    // Akun sudah dihapus (mis. dari HP lain): sesi di sini dibersihkan
    await setSession(null);
    logoutListeners.forEach((fn) => fn());
  }
  if (res.status === 401 && code === 'TOKEN_EXPIRED' && retry && (await refreshSession())) {
    return request<T>(method, path, body, false);
  }
  throw new ApiError(res.status, code, data?.error?.message ?? 'Terjadi kesalahan');
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: Body) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: Body) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: Body) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

// Unggah gambar dari URI lokal (hasil image picker)
export function imageForm(uri: string, mimeType?: string | null) {
  const type = mimeType ?? 'image/jpeg';
  const ext = type.split('/')[1] ?? 'jpg';
  const form = new FormData();
  // React Native menerima objek {uri, name, type} sebagai file
  form.append('file', { uri, name: `foto.${ext}`, type } as unknown as Blob);
  return form;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Terjadi kesalahan';
}
