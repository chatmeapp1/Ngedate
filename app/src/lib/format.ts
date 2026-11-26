// 1500 -> "1.5k", 481600 -> "481.6k", 1000000 -> "1M", 2500000000 -> "2.5B"
export function compact(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v: number, unit: string) => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;
  if (abs >= 1e9) return fmt(Math.round((n / 1e9) * 10) / 10, 'B');
  if (abs >= 1e6) return fmt(Math.round((n / 1e6) * 10) / 10, 'M');
  if (abs >= 1e3) return fmt(Math.round((n / 1e3) * 10) / 10, 'k');
  return String(n);
}

// 1234567 -> "1.234.567"
export function number(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function lastSeen(iso?: string | null, online?: boolean): string {
  if (online) return 'Online';
  if (!iso) return 'Offline';
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return 'Baru saja aktif';
  if (diff < 60) return `Aktif ${Math.round(diff)} mnt lalu`;
  if (diff < 1440) return `Aktif ${Math.round(diff / 60)} jam lalu`;
  return `Aktif ${Math.round(diff / 1440)} hari lalu`;
}

export function replyTime(minutes?: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `Biasanya membalas dalam ${minutes} menit`;
  const h = Math.round(minutes / 60);
  return h < 24 ? `Biasanya membalas dalam ${h} jam` : 'Biasanya membalas dalam 1 hari';
}
