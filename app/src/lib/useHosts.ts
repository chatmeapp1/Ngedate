import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { Host } from '@/lib/types';

const PAGE_SIZE = 30;

// Daftar host dengan halaman berikutnya (scroll tanpa batas) & tarik untuk muat ulang
// path: '/api/hosts' (untuk user) atau '/api/members' (untuk host)
export function useHosts<T extends { id: number } = Host>(params: {
  tab?: string;
  country?: string;
  region?: string;
  q?: string;
  enabled?: boolean;
  path?: string;
}) {
  const { tab = 'all', country, region, q, enabled = true, path = '/api/hosts' } = params;
  const [hosts, setHosts] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = useRef(1);
  const done = useRef(false);
  const request = useRef(0);

  const query = useCallback(
    (p: number) => {
      const sp = new URLSearchParams({ tab, page: String(p) });
      if (country) sp.set('country', country);
      if (region) sp.set('region', region);
      if (q) sp.set('q', q);
      return api.get<T[]>(`${path}?${sp.toString()}`);
    },
    [tab, country, region, q, path]
  );

  const reload = useCallback(
    async (pull = false) => {
      if (!enabled) return;
      const id = ++request.current;
      pull ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const list = await query(1);
        if (id !== request.current) return;
        page.current = 1;
        done.current = list.length < PAGE_SIZE;
        setHosts(list);
      } catch (e) {
        if (id === request.current) setError(errorMessage(e));
      } finally {
        if (id === request.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [query, enabled]
  );

  const loadMore = useCallback(async () => {
    if (loading || refreshing || done.current || !enabled) return;
    const id = request.current;
    setLoading(true);
    try {
      const list = await query(page.current + 1);
      if (id !== request.current) return;
      page.current += 1;
      done.current = list.length < PAGE_SIZE;
      setHosts((prev) => {
        const seen = new Set(prev.map((h) => h.id));
        return [...prev, ...list.filter((h) => !seen.has(h.id))];
      });
    } catch {
      // abaikan; pengguna bisa scroll lagi
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [loading, refreshing, query, enabled]);

  useEffect(() => {
    if (enabled) reload();
    else setHosts([]);
  }, [reload, enabled]);

  return { hosts, loading, refreshing, error, reload, loadMore };
}
