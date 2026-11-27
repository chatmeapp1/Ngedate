import { Alert } from 'react-native';
import { EN } from '@/lib/i18nEn';
import { storage } from '@/lib/storage';

/**
 * Bahasa aplikasi: Indonesia (id, bawaan teks di kode) dan Inggris (en).
 * Teks di kode ditulis dalam bahasa Indonesia; saat bahasa Inggris aktif, setiap teks dicari di kamus (lib/i18nEn.ts)
 * lalu diganti. Teks yang tidak ada di kamus tampil apa adanya. Bagian yang berubah ditulis {0}, {1} di kamus.
 */
export type Lang = 'id' | 'en';
export const LANG_KEY = 'amora.lang';

let current: Lang = 'id';
const listeners = new Set<(l: Lang) => void>();

export const getLang = () => current;
export function onLangChange(fn: (l: Lang) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Bahasa awal: pilihan tersimpan, lalu bahasa HP (Indonesia = id, selain itu en). */
export function deviceLang(): Lang {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale || '';
    return /^(id|in)\b/i.test(loc) ? 'id' : 'en';
  } catch {
    return 'id';
  }
}

export async function loadLang(): Promise<Lang> {
  const saved = await storage.get(LANG_KEY).catch(() => null);
  const l: Lang = saved === 'id' || saved === 'en' ? saved : deviceLang();
  current = l;
  return l;
}

export function setLang(l: Lang) {
  current = l;
  storage.set(LANG_KEY, l).catch(() => {});
  listeners.forEach((fn) => fn(l));
}

// ---------- pencarian di kamus ----------
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Pattern = { re: RegExp; to: string };
let exact: Map<string, string> | null = null;
let patterns: Pattern[] = [];

function build() {
  exact = new Map();
  patterns = [];
  for (const [id, en] of Object.entries(EN)) {
    if (!/\{\d+\}/.test(id)) {
      exact.set(norm(id), en);
      continue;
    }
    const src = id.split(/(\{\d+\})/).map((p) => (/^\{\d+\}$/.test(p) ? '(.+?)' : esc(norm(p).length === p.length ? p : p.replace(/\s+/g, ' ')))).join('');
    patterns.push({ re: new RegExp(`^${src}$`), to: en });
  }
  // pola yang lebih panjang (lebih spesifik) dicoba lebih dulu
  patterns.sort((a, b) => b.re.source.length - a.re.source.length);
}

const cache = new Map<string, string>();

/** Terjemahkan satu teks ke bahasa aktif. Spasi di awal/akhir dipertahankan. */
export function tr(text: string): string {
  if (current === 'id' || !text) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  if (!exact) build();
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  const core = norm(text);
  let out: string | undefined = exact!.get(core);
  if (out === undefined) {
    for (const p of patterns) {
      const m = core.match(p.re);
      if (m) {
        out = p.to.replace(/\{(\d+)\}/g, (_, n) => m[Number(n) + 1] ?? '');
        break;
      }
    }
  }
  const result = out === undefined ? text : lead + out + trail;
  if (cache.size > 3000) cache.clear();
  cache.set(text, result);
  return result;
}

/** Cek apakah teks punya padanan di kamus (tanpa menggantinya). */
export function hasTranslation(text: string) {
  return tr(text) !== text;
}

/**
 * Terjemahkan anak elemen <Text>: string/angka digabung dulu agar kalimat utuh ({n} menit lalu) cocok,
 * jika tidak cocok tiap potongan string diterjemahkan sendiri.
 */
export function trChildren(children: unknown): unknown {
  if (current === 'id') return children;
  if (typeof children === 'string') return tr(children);
  if (!Array.isArray(children)) return children;
  const flat = children.flat(Infinity) as unknown[];
  if (flat.every((c) => typeof c === 'string' || typeof c === 'number')) {
    const joined = flat.join('');
    const whole = tr(joined);
    if (whole !== joined) return whole;
  }
  return children.map((c) => (typeof c === 'string' ? tr(c) : c));
}

// Alert.alert: judul, isi, dan teks tombol ikut diterjemahkan
let alertPatched = false;
export function patchAlert() {
  if (alertPatched) return;
  alertPatched = true;
  const orig = Alert.alert.bind(Alert);
  Alert.alert = (title: string, message?: string, buttons?: any, options?: any) =>
    orig(
      tr(title),
      message ? tr(message) : message,
      Array.isArray(buttons) ? buttons.map((b: any) => (b && typeof b.text === 'string' ? { ...b, text: tr(b.text) } : b)) : buttons,
      options
    );
}
