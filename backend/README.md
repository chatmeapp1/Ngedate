# Ngedate Backend

Backend untuk aplikasi chat DM berbayar: user membayar koin untuk chat dengan host,
host mendapat penghasilan saat membalas, gift dengan animasi, dan nomor WhatsApp host
terbuka setelah total gift mencapai syarat.

Dibangun dari pola backend Kilive (Express + PostgreSQL + JWT + socket.io), ditulis ulang
dengan database sungguhan dan transaksi koin yang aman.

## Aturan ekonomi

| Aksi | Yang terjadi |
|---|---|
| User kirim pesan | Koin sebesar tarif host **ditahan** (`held`). Host belum menerima apa-apa. |
| Host membalas | Semua koin yang ditahan di percakapan itu dibagi: **50% host (diamond)**, **50% platform**. |
| Host tidak membalas dalam `reply_window_hours` (default 24 jam) | Koin **dikembalikan** ke user otomatis (`refunded`). |
| User kirim gift | Koin langsung dipotong; 50% jadi diamond host, 50% platform. Ditambahkan ke `gift_total` percakapan. |
| `gift_total` ≥ syarat host | Nomor WhatsApp terbuka untuk user itu (sekali buka, selamanya terbuka). |
| Pesan berisi nomor HP / link / akun sosmed | Ditolak (`422 CONTACT_BLOCKED`), untuk kedua pihak. |

Persentase, batas tarif, batas syarat WA, dan batas waktu balasan bisa diubah admin
lewat `PATCH /api/admin/settings` tanpa deploy ulang.

### Keamanan saldo
- Kolom `coins` dan `diamonds` punya `CHECK (>= 0)`, jadi saldo tidak mungkin minus.
- Setiap pemotongan memakai `UPDATE ... WHERE coins + x >= 0` di dalam transaksi, sehingga
  permintaan bersamaan tidak bisa memakai saldo yang sama dua kali (ada test-nya).
- Setiap perubahan saldo dicatat di tabel `ledger`; jumlah ledger selalu sama dengan saldo.
- Nomor WhatsApp hanya dikirim ke user yang sudah membuka; tidak pernah muncul di daftar host.

## Menjalankan

```bash
cd backend
cp .env.example .env      # isi DATABASE_URL, JWT_SECRET, REFRESH_TOKEN_SECRET
npm install
npm run seed              # buat tabel + admin pertama (ADMIN_USERNAME/ADMIN_PASSWORD) + gift contoh
npm start                 # tabel otomatis dibuat/diperbarui saat start
```

Foto disimpan di folder `UPLOAD_DIR` (default `backend/uploads`) dan disajikan di `/uploads/...`.
Set `PUBLIC_URL` ke alamat publik server (mis. `https://api.amora.app`) supaya link foto benar.
Di hosting yang disk-nya tidak permanen, foto bisa hilang saat redeploy; untuk produksi
sebaiknya diganti ke penyimpanan seperti Cloudinary / S3 / Cloudflare R2 (cukup ubah `src/lib/storage.js`).

Database: PostgreSQL apa saja (Neon, Supabase, Railway, lokal). Untuk Neon/Supabase set `DATABASE_SSL=true`.

### Test
```bash
DATABASE_URL=postgres://postgres@localhost:5432/ngedate_test npm test
```
Database test akan **dikosongkan**; namanya wajib mengandung kata `test`.
Test juga otomatis jalan di GitHub Actions setiap ada perubahan di `backend/`.

## API

Semua endpoint (kecuali auth) butuh header `Authorization: Bearer <accessToken>`.
Error selalu berbentuk `{ "error": { "code": "...", "message": "..." } }`.

### Auth
| Method | Path | Body | Keterangan |
|---|---|---|---|
| POST | `/api/auth/register` | `{ username, password, displayName?, email? }` | Selalu jadi role `user` |
| POST | `/api/auth/login` | `{ login, password }` | `login` = username atau email |
| POST | `/api/auth/refresh` | `{ refreshToken }` | Mengembalikan access token + refresh token **baru** (yang lama hangus) |
| POST | `/api/auth/logout` | `{ refreshToken }` | |

Access token berlaku 15 menit, refresh token 30 hari.

### Profil, host, dompet, gift
| Method | Path | Keterangan |
|---|---|---|
| GET / PATCH | `/api/me` | Profil sendiri (`displayName, bio, gender, birthDate, countryCode` — minimal 18 tahun) |
| POST | `/api/me/avatar` | Ganti foto profil (multipart, field `file`, JPG/PNG/WEBP maks 5 MB) |
| GET / POST | `/api/me/photos` | Album foto (maks 12; POST multipart field `file`) |
| DELETE | `/api/me/photos/:id` | Hapus foto album |
| GET | `/api/hosts?q=&country=ID&tab=all\|popular\|new\|online&page=1` | Daftar & cari host |
| GET | `/api/hosts/countries` | Jumlah host per negara `[{ code, count }]` |
| GET | `/api/hosts/:id` | Profil host: + `followers, following, likes, isFollowing, isLiked, photos, avgReplyMinutes, conversation` |
| GET | `/api/hosts/:id/gifts` | Dinding hadiah: `{ gifts, topSenders }` |
| POST / DELETE | `/api/users/:id/follow` | Ikuti / berhenti mengikuti |
| POST / DELETE | `/api/users/:id/like` | Suka / batal suka (host saja) |
| GET / PATCH | `/api/host/settings` | **Host saja**: `{ chatPrice, waEnabled, waNumber, waUnlockThreshold }` + batas min/maks |
| GET | `/api/wallet` | `{ coins, diamonds, heldCoins }` |
| GET | `/api/wallet/ledger?before=<id>` | Riwayat transaksi |
| GET | `/api/gifts` | Daftar gift aktif |

### Chat
| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/api/conversations` | | Daftar percakapan (user & host) |
| POST | `/api/conversations` | `{ hostId }` | Buka/buat percakapan (user saja) |
| GET | `/api/conversations/:id` | | Detail percakapan |
| GET | `/api/conversations/:id/messages?before=<id>&limit=30` | | Riwayat pesan |
| POST | `/api/conversations/:id/messages` | `{ body }` | Kirim pesan. `402 INSUFFICIENT_COINS` / `422 CONTACT_BLOCKED` |
| POST | `/api/conversations/:id/gifts` | `{ giftId, count }` | Kirim gift (user saja) |
| GET | `/api/conversations/:id/whatsapp` | | `{ enabled, threshold, giftTotal, unlocked, number, link }` |
| POST | `/api/conversations/:id/read` | | Tandai sudah dibaca |

### Admin (role `admin`)
| Method | Path | Body |
|---|---|---|
| GET | `/api/admin/users?q=` | |
| PATCH | `/api/admin/users/:id/role` | `{ role: "host" \| "user" }` |
| PATCH | `/api/admin/users/:id/status` | `{ status: "active" \| "suspended" }` |
| POST | `/api/admin/users/:id/coins` | `{ amount, note }` — top up manual (sementara, sebelum Google Play Billing) |
| GET / POST | `/api/admin/gifts` | `{ name, price, imageUrl, animationUrl, soundUrl, category, sortOrder, active }` |
| PATCH | `/api/admin/gifts/:id` | |
| GET / PATCH | `/api/admin/settings` | `host_share, chat_price_min/max, wa_threshold_min/max, reply_window_hours` |
| GET | `/api/admin/stats` | Pendapatan platform, jumlah user, koin yang sedang ditahan |

## Realtime (socket.io)

```js
const socket = io(BASE_URL, { auth: { token: accessToken } });
```

| Event dari server | Data |
|---|---|
| `message:new` | `{ conversationId, message, conversation }` |
| `wallet:update` | `{ coins, diamonds }` |
| `wa:unlocked` | `{ conversationId }` |
| `chat:refunded` | `{ conversationId, amount, messageIds }` |
| `typing` | `{ conversationId, userId }` |

Aplikasi boleh mengirim `typing` `{ conversationId }`.
