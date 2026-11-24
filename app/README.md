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

## Cek kode
```bash
npm ci
npx tsc --noEmit
```
