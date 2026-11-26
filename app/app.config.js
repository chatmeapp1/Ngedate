const fs = require('fs');
const path = require('path');

// Notifikasi push Android butuh google-services.json dari Firebase (letakkan di folder app/).
// Tanpa file itu, aplikasi tetap dibangun normal; hanya notifikasi saat aplikasi tertutup yang tidak aktif.
module.exports = ({ config }) => {
  const file = path.join(__dirname, 'google-services.json');
  if (fs.existsSync(file)) {
    config.android = { ...config.android, googleServicesFile: './google-services.json' };
  }
  return config;
};
