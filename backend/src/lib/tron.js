const crypto = require('crypto');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let zeros = 0;
  for (const ch of str) {
    if (ch === '1') zeros += 1;
    else break;
  }
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, 'hex')]);
}

/**
 * Alamat Tron (jaringan TRC20) yang valid: diawali "T", 34 karakter Base58, dan checksum-nya cocok.
 * Satu huruf yang salah ketik pasti terdeteksi, karena kiriman kripto yang salah alamat tidak bisa ditarik kembali.
 */
function isTronAddress(address) {
  if (typeof address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25 || raw[0] !== 0x41) return false;
  const payload = raw.subarray(0, 21);
  const hash = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest();
  return hash.subarray(0, 4).equals(raw.subarray(21));
}

module.exports = { isTronAddress };
