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

export function countryName(code?: string | null): string {
  if (!code) return 'Lainnya';
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

export const COUNTRY_LIST = Object.entries(COUNTRY_NAMES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));
