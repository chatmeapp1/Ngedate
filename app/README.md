# Amora (aplikasi Android)

Expo SDK 54 + Expo Router + TypeScript.

| Layar | File |
|---|---|
| Masuk / Daftar | `src/app/(auth)/` |
| Beranda (negara, tab, grid host) | `src/app/(tabs)/index.tsx` |
| Pesan / Dompet / Saya | `src/app/(tabs)/` |
| Cari host | `src/app/search.tsx` |
| Host per negara | `src/app/country/[code].tsx` |
| Profil host | `src/app/host/[id].tsx` |
| Edit profil & album | `src/app/edit-profile.tsx` |
| Pengaturan host (tarif & WhatsApp) | `src/app/host-settings.tsx` |
| Alamat server | `src/app/server.tsx` |

Alamat backend diatur di dalam aplikasi (layar **Alamat server**), jadi tidak perlu build ulang
saat server pindah. Bisa juga diisi bawaan lewat `expo.extra.apiUrl` di `app.json`.

## Build APK
Otomatis lewat GitHub Actions (`.github/workflows/build-apk.yml`) setiap ada perubahan di `app/`.
Unduh dari tab **Actions → Build APK (Amora) → Artifacts → amora-apk**.

Catatan: APK ini ditandatangani dengan kunci debug (cukup untuk dicoba di HP).
Untuk rilis di Play Store perlu kunci rilis sendiri (Job 7).

## Update OTA (tanpa build APK)
Aplikasi memakai **expo-updates + EAS Update** (project `@meong11/amora`, channel `production`).
Setiap push ke `main` yang mengubah folder `app/` otomatis dipublish lewat
`.github/workflows/ota-update.yml` (butuh secret `EXPO_TOKEN`). HP mengunduh update saat
aplikasi dibuka, lalu muncul banner **"Versi baru siap — Mulai ulang"**.

OTA hanya untuk perubahan JavaScript/UI/gambar. Untuk perubahan native (paket native baru,
izin Android, ikon, nama aplikasi, upgrade SDK): **naikkan `version` di `app.json`**
(mis. 1.0.0 → 1.1.0, juga `android.versionCode`) lalu pasang APK baru. `runtimeVersion` mengikuti
`version`, sehingga update untuk versi baru tidak terkirim ke APK lama yang tidak cocok.

Publish manual dari komputer/Termux:
```bash
npx eas-cli update --channel production --platform android --message "pesan"
```

## Cek kode
```bash
npm ci
npx tsc --noEmit
```
