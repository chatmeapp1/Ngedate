import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '@/lib/api';

/**
 * Status online yang selalu segar untuk daftar yang tampil: cek ke server tiap 20 detik selama layar terbuka
 * dan saat app kembali dibuka. Mengembalikan peta id -> online (kosong sampai cek pertama selesai).
 */
export function usePresence(ids: number[]): Record<number, boolean> {
  const [map, setMap] = useState<Record<number, boolean>>({});
  const idsRef = useRef<number[]>(ids);
  idsRef.current = ids;
  const key = ids.slice(0, 100).join(',');

  const check = useCallback(() => {
    const list = idsRef.current.slice(0, 100);
    if (!list.length) return;
    api
      .get<Record<string, boolean>>(`/api/presence?ids=${list.join(',')}`)
      .then((r) => setMap(Object.fromEntries(Object.entries(r).map(([k, v]) => [Number(k), v]))))
      .catch(() => {});
  }, []);

  // Cek ulang segera saat daftar berubah
  useEffect(() => {
    check();
  }, [key, check]);

  // Cek berkala selama layar ini terlihat
  useFocusEffect(
    useCallback(() => {
      check();
      const t = setInterval(check, 20_000);
      const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
      return () => {
        clearInterval(t);
        sub.remove();
      };
    }, [check])
  );

  return map;
}
