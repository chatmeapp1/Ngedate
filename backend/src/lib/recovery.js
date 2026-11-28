const crypto = require('crypto');

// Tanpa huruf/angka yang mudah tertukar (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomChars(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/** Kode pemulihan: 12 karakter (±59 bit), ditulis XXXX-XXXX-XXXX. */
function generateRecoveryCode() {
  const c = randomChars(12);
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

/** Rapikan masukan pengguna: huruf besar, buang spasi/strip. */
function normalizeRecoveryCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Password sementara dari admin: 10 karakter. */
function generateTempPassword() {
  return randomChars(10);
}

module.exports = { generateRecoveryCode, normalizeRecoveryCode, generateTempPassword };
