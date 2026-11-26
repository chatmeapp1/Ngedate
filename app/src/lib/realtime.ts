import { io, type Socket } from 'socket.io-client';
import { api, getAccessToken, getServerUrl } from '@/lib/api';

/**
 * Koneksi realtime (socket.io) ke backend.
 * Event dari server: message:new, wallet:update, wa:unlocked, chat:refunded, chat:settled, typing
 */
let socket: Socket | null = null;
const CONNECT_EVENT = '__connect';
const listeners = new Map<string, Set<(payload: any) => void>>();

export function connectRealtime() {
  if (socket) {
    // Socket lama ada tapi terputus dan tidak menyambung sendiri (mis. token kedaluwarsa): sambungkan lagi
    if (!socket.connected && !socket.active) socket.connect();
    return;
  }
  const url = getServerUrl();
  if (!url || !getAccessToken()) return;

  socket = io(url, {
    transports: ['websocket'],
    // Fungsi: token terbaru dipakai setiap kali menyambung ulang
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnectionDelayMax: 10_000,
  });

  // Setiap (re)connect: layar memuat ulang data terbaru, karena pesan yang datang saat terputus tidak terkirim lewat socket
  socket.on('connect', () => {
    listeners.get(CONNECT_EVENT)?.forEach((fn) => fn(undefined));
  });

  socket.on('connect_error', async (err) => {
    if (err.message === 'UNAUTHORIZED') {
      // Token kedaluwarsa: panggil API supaya token diperbarui, lalu sambung lagi
      await api.get('/api/me').catch(() => {});
      setTimeout(() => {
        if (socket && !socket.connected) socket.connect();
      }, 1500);
    }
  });

  socket.onAny((event: string, payload: unknown) => {
    listeners.get(event)?.forEach((fn) => fn(payload));
  });
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
}

export function onRealtime<T = any>(event: string, fn: (payload: T) => void) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
  return () => {
    listeners.get(event)?.delete(fn);
  };
}

/** Dipanggil setiap kali socket tersambung (termasuk menyambung ulang). */
export function onRealtimeConnect(fn: () => void) {
  return onRealtime(CONNECT_EVENT, fn);
}

export function emitRealtime(event: string, payload: unknown) {
  socket?.emit(event, payload);
}
