import type { RegionKey } from '@/lib/types';

// Label, warna gradien, dan ikon cadangan tiap wilayah (urutan sama dengan backend)
export const REGION_INFO: Record<RegionKey, { label: string; emoji: string; colors: readonly [string, string] }> = {
  asia: { label: 'Asia', emoji: '🌏', colors: ['#F59E5B', '#F8B98A'] },
  arab: { label: 'Arab', emoji: '🌙', colors: ['#14B8A6', '#5EEAD4'] },
  india: { label: 'India', emoji: '🪷', colors: ['#EC4899', '#F9A8D4'] },
  latino: { label: 'Latino', emoji: '🌴', colors: ['#8B5CF6', '#C4B5FD'] },
  afrika: { label: 'Afrika', emoji: '🌍', colors: ['#F97362', '#FDA4AF'] },
  barat: { label: 'Barat', emoji: '🗽', colors: ['#3B82F6', '#93C5FD'] },
};
