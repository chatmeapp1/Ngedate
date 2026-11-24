// Palet Amora: ungu ke pink, lembut dan romantis
export const colors = {
  bg: '#FFF7FB',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F1FA',
  border: '#EEE6F3',
  text: '#1F1430',
  textSub: '#6E6280',
  textDim: '#A79DB5',
  primary: '#8B5CF6',
  primaryDark: '#6D3FE0',
  pink: '#EC4899',
  coral: '#FB7185',
  gold: '#F5B301',
  online: '#22C55E',
  danger: '#EF4444',
  white: '#FFFFFF',
  overlay: 'rgba(17, 10, 30, 0.55)',
};

export const gradients = {
  brand: ['#8B5CF6', '#EC4899'] as const,
  soft: ['#F3E8FF', '#FFE4F1'] as const,
  header: ['#EDE3FF', '#FFE9F4', '#FFF7FB'] as const,
  photoFade: ['transparent', 'rgba(17,10,30,0.75)'] as const,
};

// Warna kartu negara, dipakai bergiliran
export const countryCardGradients: readonly (readonly [string, string])[] = [
  ['#F59E5B', '#F7B77E'],
  ['#2DD4BF', '#5EEAD4'],
  ['#F472B6', '#FB9AC7'],
  ['#A78BFA', '#C4B5FD'],
  ['#FB7185', '#FDA4AF'],
  ['#60A5FA', '#93C5FD'],
];

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 };
