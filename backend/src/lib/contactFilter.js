// Mencegah nomor HP / link / username sosmed dibagikan lewat chat,
// supaya user tidak bisa mengakali syarat buka WhatsApp.

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

function containsContact(text) {
  if (!text) return false;
  return PATTERNS.some((re) => re.test(text));
}

module.exports = { containsContact };
