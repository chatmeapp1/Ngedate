import { getLang } from '@/lib/i18n';
// Nama negara dalam bahasa Indonesia. Bendera dibuat dari kode negara (emoji).
export const COUNTRY_NAMES: Record<string, string> = {
  ID: 'Indonesia', MY: 'Malaysia', SG: 'Singapura', PH: 'Filipina', TH: 'Thailand',
  VN: 'Vietnam', LA: 'Laos', KH: 'Kamboja', MM: 'Myanmar', BN: 'Brunei', TL: 'Timor Leste',
  CN: 'Tiongkok', TW: 'Taiwan', HK: 'Hong Kong', JP: 'Jepang', KR: 'Korea Selatan',
  IN: 'India', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Nepal',
  SA: 'Arab Saudi', AE: 'Uni Emirat Arab', QA: 'Qatar', KW: 'Kuwait', OM: 'Oman',
  EG: 'Mesir', MA: 'Maroko', TR: 'Turki', IR: 'Iran', IQ: 'Irak', JO: 'Yordania',
  NG: 'Nigeria', KE: 'Kenya', ZA: 'Afrika Selatan', GH: 'Ghana', ET: 'Etiopia',
  US: 'Amerika Serikat', CA: 'Kanada', MX: 'Meksiko', BR: 'Brasil', AR: 'Argentina',
  CO: 'Kolombia', PE: 'Peru', CL: 'Chili', VE: 'Venezuela',
  GB: 'Inggris', FR: 'Prancis', DE: 'Jerman', ES: 'Spanyol', IT: 'Italia', NL: 'Belanda',
  RU: 'Rusia', UA: 'Ukraina', PL: 'Polandia', AU: 'Australia', NZ: 'Selandia Baru',
};

export function flag(code?: string | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '🌐';
  const base = 0x1f1e6;
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => base + c.charCodeAt(0) - 65));
}

const COUNTRY_NAMES_EN: Record<string, string> = {
  ID: 'Indonesia', MY: 'Malaysia', SG: 'Singapore', PH: 'Philippines', TH: 'Thailand', VN: 'Vietnam', LA: 'Laos', KH: 'Cambodia', MM: 'Myanmar', BN: 'Brunei', TL: 'Timor-Leste',
  CN: 'China', TW: 'Taiwan', HK: 'Hong Kong', JP: 'Japan', KR: 'South Korea', IN: 'India', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Nepal',
  SA: 'Saudi Arabia', AE: 'United Arab Emirates', QA: 'Qatar', KW: 'Kuwait', OM: 'Oman', EG: 'Egypt', MA: 'Morocco', TR: 'Turkey', IR: 'Iran', IQ: 'Iraq', JO: 'Jordan',
  NG: 'Nigeria', KE: 'Kenya', ZA: 'South Africa', GH: 'Ghana', ET: 'Ethiopia', US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', AR: 'Argentina',
  CO: 'Colombia', PE: 'Peru', CL: 'Chile', VE: 'Venezuela', GB: 'United Kingdom', FR: 'France', DE: 'Germany', ES: 'Spain', IT: 'Italy', NL: 'Netherlands',
  RU: 'Russia', UA: 'Ukraine', PL: 'Poland', AU: 'Australia', NZ: 'New Zealand',
};

export function countryName(code?: string | null): string {
  if (!code) return getLang() === 'en' ? 'Other' : 'Lainnya';
  const c = code.toUpperCase();
  return (getLang() === 'en' ? COUNTRY_NAMES_EN[c] : undefined) ?? COUNTRY_NAMES[c] ?? c;
}

// Daftar negara menurut bahasa aktif (nama dan urutan alfabet mengikuti bahasa)
export function countryList() {
  return Object.keys(COUNTRY_NAMES)
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export const COUNTRY_LIST = countryList();
