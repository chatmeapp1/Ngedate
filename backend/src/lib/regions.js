// Pengelompokan negara ke wilayah untuk kartu di Beranda
const REGIONS = {
  asia: ['ID', 'MY', 'SG', 'PH', 'TH', 'VN', 'LA', 'KH', 'MM', 'BN', 'TL', 'CN', 'TW', 'HK', 'MO', 'JP', 'KR', 'MN'],
  arab: ['SA', 'AE', 'QA', 'KW', 'OM', 'BH', 'YE', 'EG', 'MA', 'DZ', 'TN', 'LY', 'JO', 'IQ', 'LB', 'SY', 'PS', 'SD'],
  india: ['IN', 'PK', 'BD', 'LK', 'NP', 'BT', 'MV', 'AF'],
  latino: ['MX', 'BR', 'AR', 'CO', 'PE', 'CL', 'VE', 'EC', 'BO', 'PY', 'UY', 'CR', 'PA', 'GT', 'HN', 'SV', 'NI', 'DO', 'CU', 'PR'],
  afrika: ['NG', 'KE', 'ZA', 'GH', 'ET', 'TZ', 'UG', 'CM', 'CI', 'SN', 'AO', 'ZW', 'ZM', 'RW', 'MZ', 'MG', 'ML', 'BF', 'NE', 'CD', 'CG', 'GA', 'BJ', 'TG'],
  barat: ['US', 'CA', 'GB', 'IE', 'FR', 'DE', 'ES', 'PT', 'IT', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'RO', 'HU', 'GR', 'RU', 'UA', 'TR', 'AU', 'NZ'],
};

const REGION_KEYS = Object.keys(REGIONS);

function regionOf(code) {
  if (!code) return null;
  const c = code.toUpperCase();
  return REGION_KEYS.find((k) => REGIONS[k].includes(c)) || null;
}

module.exports = { REGIONS, REGION_KEYS, regionOf };
