-- ID pengguna 6 digit: akun baru mulai dari 100001 (lalu 100002, 100003, ...).
-- Aman dijalankan pada database yang sudah berisi: nomor berikutnya tidak pernah lebih kecil
-- dari ID terbesar yang ada. Jika pengguna melewati 999999, ID otomatis menjadi 7 digit.
SELECT setval('users_id_seq', GREATEST(100000, (SELECT COALESCE(MAX(id), 0) FROM users)));
