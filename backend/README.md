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
| GET | `/api/hosts?q=&country=ID&region=asia&tab=all\|popular\|new\|online&page=1` | Daftar & cari host |
| GET | `/api/hosts/regions` | 6 wilayah (asia, arab, india, latino, afrika, barat) `[{ key, count, coverUrl }]` — selalu lengkap, `coverUrl` = foto host teratas |
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

## ID pengguna & mengosongkan database

ID akun berupa angka 6 digit yang naik berurutan mulai dari **100001** (migrasi `009`). Pengguna masuk lewat
"Login via Akun" dengan **ID + password**.

Untuk memulai dari nol (menghapus **semua** data, termasuk file unggahan, lalu membuat ulang admin & gift contoh):

```bash
CONFIRM_RESET=HAPUS-SEMUA-DATA ADMIN_USERNAME=amora ADMIN_PASSWORD=ganti-ini npm run reset-db
```

Tanpa `CONFIRM_RESET=HAPUS-SEMUA-DATA` perintah ini dibatalkan. Hanya file unggahan buatan aplikasi yang dihapus,
file lain di folder yang sama tidak disentuh. Admin mendapat ID 100001, akun pertama pengguna 100002.

## Pembagian hasil & penarikan diamond host

Tiap koin gift/pesan dibagi: **host 30% bersih**, **komisi agency 10% dari PENGHASILAN HOST** (per agency, dibayar dari bagian app, host tidak berkurang;
mis. chat 100 koin: host 30, agency 3, platform 67). Host tanpa agency: host 30%, platform 70%. Bagian host diatur di panel admin > Pengaturan.

Host menarik diamond di aplikasi (Dompet > Tarik, atau Saya > Tarik diamond). Kurs awal: **6.667 diamond = 1 USD**
(sama dengan harga jual koin ~ Rp 2,55 pada Rp 17.000/USD), minimal **70.000 diamond** (US$ 10,50). Metode mengikuti negara di profil host:

- **Indonesia**: bank / e-wallet, dibayar dalam **Rupiah** (kurs Rp 17.000/USD, bisa diubah).
- **Negara lain**: **USDT jaringan TRC20**, dibayar dalam **USD** (dikurangi biaya jaringan tetap, awal US$ 1).
  Alamat dompet divalidasi (awalan T, 34 karakter, checksum Base58) supaya salah ketik langsung ditolak.

Alurnya manual: host menyimpan rekening/alamat (wajib punya password dan mengisi password), mengajukan penarikan
(diamond **langsung ditahan**, satu pengajuan menunggu per host), lalu admin membuka **Penarikan** di panel, transfer/kirim USDT,
dan **Tandai sudah dibayar** (nomor referensi / TXID opsional). Jika ditolak (wajib alasan), diamond otomatis dikembalikan.
Host juga bisa membatalkan sendiri. Pengaman: mengubah rekening/alamat menahan penarikan 24 jam; akun tidak bisa dihapus
saat ada penarikan berjalan.

## Paket koin & Top up

Layar **Top up** di aplikasi menampilkan paket koin dari panel admin > **Paket koin**. Harga awal: Rp 2 per koin
(18.000 koin = Rp 36.000): 18.000 / 36.000 / 54.000 / 90.000 / 180.000 / 450.000 / 900.000 / 1.800.000 koin.
Harga jual koin (`coin_price_idr`) dan nilai diamond host (kurs penarikan) adalah dua pengaturan terpisah.
Pengguna di Indonesia melihat harga Rupiah, negara lain harga USD. Mengetuk paket membuka WhatsApp admin dengan pesan terisi
(paket + ID akun); setelah pembayaran masuk, admin menambah koin lewat menu **Top up koin**. Nomor WhatsApp admin dan catatan
pembayaran diatur di halaman Paket koin. Pembelian otomatis lewat Google Play Billing belum dipasang (butuh APK baru).

### Pengaman anti-rugi

Nilai awal: 1 diamond = Rp 2,55 (`withdraw_diamonds_per_usd` 6.667, kurs Rp 17.000/USD). Host menerima 10% dari harga gift
(`gift_host_share`); gift bertanda **x2** (diatur per gift di panel admin) memberi host 20%. Pesan chat berbayar tetap 30% (`host_share`).
Komisi agency 10% dari penghasilan host. Pengaman margin selalu memakai jalur host terbesar (termasuk pengali gift).
Server menghitung untung per koin pada skenario terburuk (PPN 11% + potongan Google Play 30%) memakai paket termurah dan komisi
agency tertinggi, dan **menolak** (`NEGATIVE_MARGIN`) pengaturan, harga paket, atau komisi agency yang membuat rugi atau
memperburuk kerugian. Kartu margin tampil di panel admin (Pengaturan dan Paket koin). Migrasi 011/012 mengembalikan
`withdraw_diamonds_per_usd` dan `coin_price_idr` ke nilai awal ini.

## Level, VIP, dan kartu pesan gratis

Level (0-10) dan VIP (1-5) dihitung dari **total top up koin** (`users.topup_total`, bertambah saat admin menambah koin lewat
**Top up koin**; pengurangan/penyesuaian tidak menurunkan). Batas awal Level: 0, 2.000, 30.000, 80.000, 150.000, 250.000,
500.000, 1 juta, 2 juta, 5 juta, 10 juta koin. Batas VIP: 300.000, 700.000, 1,4 juta, 2,8 juta, 4 juta koin. Keduanya bisa diubah
di panel admin > Pengaturan (`level_thresholds`, `vip_thresholds`).

Pengguna VIP mendapat kartu pesan gratis (`free_cards_per_day`, awal 5 per hari, hari WIB): pesan ke host berbayar tidak
memotong koin, dan host menerima `free_card_host_diamonds` (awal 5 diamond) yang dibayar app. `GET /api/me` mengirim
`membership` (level, vip, progres, kartu tersisa).

**Foto & video di chat (VIP):** `POST /api/conversations/:id/media` (multipart, field `file`; foto JPG/PNG/WEBP maks 5 MB,
video MP4 maks 15 MB, isi file diperiksa). Khusus pengguna VIP ke host, tidak memotong koin, batas `vip_media_per_day` (awal 30)
per hari. File disimpan di `UPLOAD_DIR` (di hosting tanpa disk permanen, pindahkan ke S3/R2).

## Notifikasi push & suara gift

**Suara gift:** panel admin > Gift > Ubah gift > "Suara gift" (MP3/M4A/AAC/OGG/WAV, maks 2 MB). Diputar sekali di HP pengirim dan
penerima saat gift datang.

**Notifikasi push (Android, Firebase Cloud Messaging):** dikirim hanya untuk **gift** ke pengguna yang
sedang tidak membuka aplikasi (pesan teks/foto/video tidak, supaya tidak ramai). Ketuk notifikasi membuka chatnya. Langkah pasang (sekali saja):

1. Firebase Console > buat project > tambah aplikasi Android dengan nama paket `app.amora.chat` > unduh `google-services.json`.
2. Isi file itu ke GitHub: Settings > Secrets > Actions > `GOOGLE_SERVICES_JSON` (tempel isi file), lalu bangun APK 1.1.0.
3. Firebase > Project settings > Service accounts > Generate new private key. Simpan file JSON-nya di HP server (jangan di GitHub).
4. Di server isi variabel `FCM_SERVICE_ACCOUNT=/path/ke/file-kunci.json` (atau `FCM_SERVICE_ACCOUNT_JSON` berisi JSON-nya), restart.

Tanpa langkah 3-4 backend tidak mengirim apa pun (aman). Token perangkat disimpan di tabel `push_tokens`
(`POST/DELETE /api/me/push-token`).

## Panel agency (web) & penarikan komisi

Agency punya panel web sendiri di **`/agency`** (alamat server + `/agency`), terpisah dari `/admin`. Isinya: ringkasan saldo komisi,
daftar host + komisi tiap host, riwayat komisi, penarikan, dan ganti password.

- **Akun agency** dibuat admin: panel admin > Agency > "Buat login" (username, password awal, negara). Agency bisa mengganti
  passwordnya sendiri; mengganti password mencabut semua sesi lama. Token agency (12 jam) tidak berlaku di API pengguna/admin, dan sebaliknya.
- **Saldo** (`agencies.balance`, diamond) bertambah otomatis dari komisi (10% dari penghasilan host). `earnings_total` = total seumur hidup.
- **Penarikan** memakai kurs & aturan yang sama dengan host (minimal, biaya, USDT TRC20 untuk agency luar negeri / bank & e-wallet
  untuk Indonesia, rekening wajib + password, rekening yang diganti menahan penarikan 24 jam, satu pengajuan menunggu).
  Saldo ditahan saat mengajukan; admin membayar atau menolak (saldo kembali) di halaman **Penarikan** (bersama penarikan host,
  bertanda "AGENCY").
- Tabel: `agency_payout_accounts`, `agency_withdrawals` (migrasi 017). API agency di `/api/agency/*`.

**Level host:** host juga punya Level 0-10, dari **total penghasilan diamond 7 hari terakhir** (bergulir: chat, gift, kartu gratis;
bisa naik dan turun, menarik diamond tidak berpengaruh). Batas awal: 0, 300, 3.000, 5.000, 10.000, 70.000, 150.000, 300.000, 500.000,
1.000.000, 5.000.000 diamond; dapat diubah di panel admin > Pengaturan (`host_level_thresholds`). Pengguna melihat badge level host di profil
host (hanya levelnya, bukan jumlah penghasilan); host melihat kemajuannya di Profil > kartu Lv.

## Foto & video privat dari host

Host dapat mengirim foto atau video **privat** di chat (tombol gembok di kolom tulis) dengan harga buka yang ia tentukan (0 = gratis,
maksimum `host_media_price_max`, awal 100.000 koin). Video maksimal **5 menit** (`host_video_max_seconds`; durasi dibaca dari file di
server), foto maks 8 MB, video maks 80 MB, batas `host_media_per_day` (awal 30) per host per hari.

- Pengguna melihat kartu terkunci "Foto privat / Video privat · Buka N koin". Saat dibuka, koin dipotong seperti gift: host menerima
  `gift_host_share` (10%), agency komisi dari penghasilan host, sisanya platform (`ledger.reason = media_income`). Satu media hanya
  dibayar sekali (`media_unlocks`), dan nilainya ikut total belanja koin untuk membuka WhatsApp host.
- File disimpan di folder **privat** (`PRIVATE_DIR`, awal `../private-media` di samping folder uploads), BUKAN di `/uploads`. Hanya
  host pengirim dan pengguna di percakapan itu yang bisa mengambilnya lewat `GET /api/media/:id` (butuh login; pengguna yang belum
  membuka mendapat 402; mendukung Range untuk video). Sertakan folder ini dalam cadangan.
- API: `POST /api/conversations/:id/private-media` (multipart `file` + `price`), `POST /api/conversations/:id/media/:messageId/unlock`.

## Panel admin web

Buka `http://<alamat-server>:<port>/admin` di browser (HP juga bisa) lalu masuk dengan akun admin
(`ADMIN_USERNAME` / `ADMIN_PASSWORD` yang dipakai saat `npm run seed`). Isinya: dashboard, verifikasi wajah,
foto host, pengguna (koin, jadikan host, tangguhkan), agency + kode, gift (termasuk unggah gambar), dan pengaturan.
Halaman ini statis (folder `public/admin`), tanpa build; semua data lewat API di bawah.

### Admin (role `admin`)
| Method | Path | Body |
|---|---|---|
| GET | `/api/admin/users?q=&role=&status=` | |
| POST | `/api/admin/upload` | multipart `file` (gambar) → `{ url }` |
| PATCH | `/api/admin/users/:id/role` | `{ role: "host" \| "user" }` |
| PATCH | `/api/admin/users/:id/status` | `{ status: "active" \| "suspended" }` |
| POST | `/api/admin/users/:id/coins` | `{ amount, note }` — top up manual (sementara, sebelum Google Play Billing) |
| GET / POST | `/api/admin/gifts` | `{ name, price, imageUrl, animationUrl, soundUrl, category, sortOrder, active }` |
| PATCH | `/api/admin/gifts/:id` | |
| GET / PATCH | `/api/admin/settings` | `host_share, chat_price_min/max, wa_threshold_min/max, reply_window_hours` |
| GET | `/api/admin/stats` | Pendapatan platform, jumlah user, koin ditahan, antrean tinjauan, aktivitas 24 jam |

### Onboarding & verifikasi wajah
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/onboarding/agency/:code` | Cek kode undangan agency → `{ name }` |
| POST | `/api/onboarding/complete` | `{ gender, displayName, birthDate, inviteCode? }` — sekali saja. `male` → user; `female` → host `pending` (wajib kode agency). Foto profil wajib diunggah dulu |
| POST | `/api/onboarding/verification/challenge` | Host: 3 gerakan acak `{ challengeId, steps:[{key,text}], expiresAt }` (berlaku 3 menit, sekali pakai) |
| POST | `/api/onboarding/verification` | Multipart: `challengeId` + 3 file di field `photos` (urut sesuai gerakan) |
| GET | `/api/onboarding/verification` | Status verifikasi terakhir |

Aturan: jenis kelamin dikunci setelah diisi (`409 GENDER_LOCKED`). Host baru tidak tampil di daftar
sampai verifikasi wajah disetujui admin (lalu mendapat `verified: true` / centang biru).
Foto profil & album host masuk antrean cek admin; publik hanya melihat foto yang disetujui.

### Admin: agency, verifikasi, cek foto
| Method | Path | Body |
|---|---|---|
| GET / POST | `/api/admin/agencies` | `{ name, code?, commissionRate (0..host_share), contact? }` — kode otomatis jika kosong |
| PATCH | `/api/admin/agencies/:id` | `{ name?, commissionRate?, active?, contact? }` |
| GET | `/api/admin/verifications?status=pending` | Foto verifikasi + gerakan yang diminta + foto profil |
| POST | `/api/admin/verifications/:id/approve` / `reject` | `reject`: `{ reason }` |
| GET | `/api/admin/photos/pending` | `{ album, avatars }` |
| POST | `/api/admin/photos/:id/approve` / `reject` | `reject`: `{ reason }` |
| POST | `/api/admin/users/:id/avatar/approve` / `reject` | Foto profil host yang baru |

Bagi hasil dengan agency: komisi agency = persen dari penghasilan host, dibayar dari bagian app (host tidak berkurang).
Contoh `host_share 0.5` + komisi `0.1` → host 50%, agency 5%, platform 45%.

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
