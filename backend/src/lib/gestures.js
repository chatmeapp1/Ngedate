// Gerakan acak untuk verifikasi wajah. Video yang direkam sebelumnya
// tidak mungkin cocok dengan urutan gerakan acak ini.
const GESTURES = {
  two_fingers: 'Angkat 2 jari (peace) di samping wajah',
  thumbs_up: 'Acungkan jempol di samping wajah',
  touch_nose: 'Sentuh hidung dengan jari telunjuk',
  hold_left_ear: 'Pegang telinga kiri dengan tangan',
  hand_on_cheek: 'Tempelkan telapak tangan di pipi',
  open_palm: 'Tunjukkan telapak tangan terbuka di samping wajah',
  wink: 'Tutup satu mata sambil tersenyum',
  turn_left: 'Tolehkan kepala ke kiri',
  turn_right: 'Tolehkan kepala ke kanan',
};

const crypto = require('crypto');

function randomSteps(n = 3) {
  const keys = Object.keys(GESTURES);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.slice(0, n);
}

const describe = (steps) => steps.map((key) => ({ key, text: GESTURES[key] || key }));

module.exports = { GESTURES, randomSteps, describe };
