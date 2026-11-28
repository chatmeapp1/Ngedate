// Mencegah nomor HP / link / username sosmed dibagikan lewat chat,
// supaya user tidak bisa mengakali syarat buka WhatsApp.
//
// Lapisan:
//  1. Satu pesan: teks dinormalkan dulu (angka lebar/Arab/emoji, huruf o/l di antara angka, angka yang ditulis dengan
//     kata: "nol delapan satu ...", "zero eight one ..."), lalu dicek pola nomor, link, dan kata kunci kontak.
//  2. Beberapa pesan: nomor yang dipecah ("08", "54", "081", ...) dijumlahkan dari pesan-pesan bernuansa angka
//     milik pengirim yang sama dalam waktu singkat (lihat splitNumberLeak).

const PATTERNS = [
  // Nomor telepon: 9+ digit, boleh dipisah spasi/titik/strip, opsional +62 / 0
  /(?:\+?\d[\s.\-()]*){9,}/,
  // Link
  /\bhttps?:\/\//i,
  /\bwww\./i,
  /\b[a-z0-9-]+\.(?:com|id|net|org|me|co|io|ly|link)\b/i,
  // Kata kunci kontak
  /\bwa\.me\b/i,
  /\b(?:whats\s*app|whatsapp|watsap|wasap|w\.a\.?)\b/i,
  /\b(?:telegram|tele|line|instagram|insta|ig|tiktok|facebook|fb)\s*[:@]/i,
  /@[a-z0-9_.]{3,}/i,
];

// Angka yang ditulis dengan kata (Indonesia dan Inggris, termasuk ejaan singkat)
const WORD_DIGITS = {
  nol: '0', kosong: '0', nul: '0', zero: '0',
  satu: '1', one: '1',
  dua: '2', two: '2',
  tiga: '3', three: '3',
  empat: '4', four: '4',
  lima: '5', five: '5',
  enam: '6', six: '6',
  tujuh: '7', seven: '7',
  delapan: '8', lapan: '8', eight: '8',
  sembilan: '9', nine: '9',
};

// Angka Arab-Indic dan Persia-Indic -> angka biasa
const INDIC_ZERO = [0x0660, 0x06f0];

const SINGLE_WORD_RUN = 7; // 7 kata angka berurutan dalam satu pesan = dianggap nomor
const SPLIT_DIGITS = 8; // jumlah digit dari pesan-pesan bernuansa angka (pesan ini + sebelumnya) yang diblokir
const HEAVY_RATIO = 0.6; // pesan "bernuansa angka" = minimal 60% karakternya angka

/** Ubah teks ke bentuk yang mudah dicek: angka lebar/Arab/emoji jadi angka biasa, kata angka jadi digit. */
function normalize(text) {
  let s = String(text || '').normalize('NFKC');
  // angka Arab-Indic dan Persia-Indic
  s = s.replace(/[٠-٩۰-۹]/g, (c) => {
    const code = c.charCodeAt(0);
    const base = code >= INDIC_ZERO[1] ? INDIC_ZERO[1] : INDIC_ZERO[0];
    return String(code - base);
  });
  // emoji angka: "8️⃣" -> "8"
  s = s.replace(/[️⃣]/g, '');
  // huruf yang sering dipakai menggantikan angka di antara angka: 08l2 -> 0812, 08o2 -> 0802
  s = s.replace(/(?<=\d)[oO](?=\d)/g, '0').replace(/(?<=\d)[lI|](?=\d)/g, '1');
  return s;
}

/** Ganti kata angka menjadi digit. Mengembalikan teks baru dan jumlah kata angka terpanjang yang berurutan. */
function wordsToDigits(s) {
  let run = 0;
  let maxRun = 0;
  const out = s.replace(/[A-Za-z]+|[^A-Za-z]+/g, (tok) => {
    if (/^[A-Za-z]+$/.test(tok)) {
      const d = WORD_DIGITS[tok.toLowerCase()];
      if (d !== undefined) {
        run += 1;
        maxRun = Math.max(maxRun, run);
        return d;
      }
      run = 0;
      return tok;
    }
    // pemisah antar kata angka (spasi, titik, koma, strip) tidak memutus rangkaian
    if (!/^[\s.,\-_/]*$/.test(tok)) run = 0;
    return tok;
  });
  return { text: out, maxRun };
}

function containsContact(text) {
  if (!text) return false;
  const norm = normalize(text);
  const { text: converted, maxRun } = wordsToDigits(norm);
  if (maxRun >= SINGLE_WORD_RUN) return true;
  return PATTERNS.some((re) => re.test(norm) || re.test(converted));
}

/** Jumlah digit (setelah kata angka diubah) dan apakah pesan ini bernuansa angka. */
function digitInfo(text) {
  const { text: converted } = wordsToDigits(normalize(text));
  const digits = (converted.match(/\d/g) || []).length;
  const chars = converted.replace(/\s+/g, '').length;
  return { digits, heavy: digits > 0 && chars > 0 && digits / chars >= HEAVY_RATIO };
}

/**
 * Nomor yang dipecah ke banyak pesan pendek. `history` = isi pesan teks terbaru dari pengirim yang sama di percakapan ini
 * (batas waktu dan jumlahnya ditentukan pemanggil). True bila jumlah digit dari pesan-pesan bernuansa angka
 * (termasuk `text`) mencapai batas. Pesan biasa yang memuat angka ("umur 25", "jam 8", "Rp 100.000 ya") tidak dihitung.
 */
function splitNumberLeak(history, text) {
  const cur = digitInfo(text);
  if (!cur.heavy) return false;
  let total = cur.digits;
  for (const h of history || []) {
    const i = digitInfo(h);
    if (i.heavy) total += i.digits;
  }
  return total >= SPLIT_DIGITS;
}

module.exports = { containsContact, splitNumberLeak, digitInfo, normalize, SPLIT_DIGITS };
