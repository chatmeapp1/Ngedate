# Live stream Amora: media server (MediaMTX)

Alur:

```
HP host (OBS / Larix / Streamlabs)
   │  RTMP  rtmp://<alamat-server>:1935/live/<kunci-siaran>
   ▼
MediaMTX ──(tiap publish/read tanya)──► backend /api/live-media/auth
   │  LL-HLS di 127.0.0.1:8888
   ▼
backend  /live-hls/live/<id>/index.m3u8  ◄── aplikasi penonton (expo-video)
```

- Kunci siaran dibuat backend saat host menekan **Mulai siaran** di app (Saya → Mulai live). Kunci berbeda tiap siaran dan hanya tampil sekali.
- Penonton tidak butuh port tambahan: HLS diteruskan backend lewat alamat API yang sama (jadi cukup satu domain / satu terowongan cloudflared).
- Status siaran (menunggu → live → berakhir) disinkronkan backend tiap 3 detik dari API MediaMTX. Siaran terputus > 30 detik berakhir otomatis.

## Menjalankan di Termux (staging)

1. Unduh MediaMTX untuk HP Android (ARM64, biner Go statis; nama file berakhiran `linux_arm64v8`) dari halaman rilis resmi:
   `https://github.com/bluenviron/mediamtx/releases` → file `mediamtx_vX.Y.Z_linux_arm64v8.tar.gz`.
   ```bash
   mkdir -p ~/mediamtx && cd ~/mediamtx
   tar xzf mediamtx_*_linux_arm64v8.tar.gz mediamtx
   cp ~/ngedate/infra/mediamtx/mediamtx.yml .
   ```
   Bila `authHTTPAddress` di `mediamtx.yml` tidak memakai port backend kamu (default `3000`), ubah.
2. Atur alamat RTMP yang akan ditampilkan ke host di `backend/.env` (HP host harus bisa menjangkau alamat ini; saat staging, pakai IP WiFi HP server):
   ```
   LIVE_RTMP_PUBLIC=rtmp://192.168.1.5:1935/live
   ```
   (opsional) `LIVE_MEDIA_API` (default `http://127.0.0.1:9997`), `LIVE_HLS_UPSTREAM` (default `http://127.0.0.1:8888`).
3. Jalankan, urutannya: PostgreSQL → backend (`npm start`) → MediaMTX:
   ```bash
   cd ~/mediamtx && ./mediamtx mediamtx.yml
   ```
4. Uji tanpa app host: kirim video uji dengan ffmpeg (ganti `<kunci>` dengan kunci dari app, bentuknya `xxxxxxxxxxxxxxxx?user=live&pass=yyyy`):
   ```bash
   ffmpeg -re -f lavfi -i testsrc=size=640x360:rate=25 -f lavfi -i sine=frequency=440 \
     -c:v libx264 -preset ultrafast -tune zerolatency -g 25 -c:a aac -f flv \
     "rtmp://192.168.1.5:1935/live/<kunci>"
   ```
   Live akan muncul di Beranda → ikon kamera dalam beberapa detik.

Catatan staging: port RTMP (1935) tidak lewat cloudflared. Host menyiarkan lewat WiFi yang sama dengan HP server. Di produksi (AWS) port 1935 dibuka di security group dan `LIVE_RTMP_PUBLIC` diisi domain server.

## Keamanan

- `/api/live-media/auth` hanya menerima panggilan dari localhost (atau IP di `LIVE_AUTH_ALLOW`) dan menolak permintaan yang lewat proxy publik.
- API kendali MediaMTX (`127.0.0.1:9997`) dan HLS (`127.0.0.1:8888`) hanya dengar di localhost.
- Hanya host terverifikasi wajah yang bisa memulai siaran; admin bisa menghentikan siaran dari panel admin → Live stream.
- Obrolan live memakai filter nomor/link yang sama dengan chat, dibatasi 1 pesan per 1,2 detik per pengguna.
