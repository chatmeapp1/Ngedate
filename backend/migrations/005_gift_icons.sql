-- Ikon emoji untuk gift (dipakai jika image_url kosong)
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS icon VARCHAR(16);

UPDATE gifts SET icon = '🌹' WHERE name = 'Mawar' AND icon IS NULL;
UPDATE gifts SET icon = '❤️' WHERE name = 'Hati' AND icon IS NULL;
UPDATE gifts SET icon = '🍫' WHERE name = 'Cokelat' AND icon IS NULL;
UPDATE gifts SET icon = '🧸' WHERE name = 'Boneka' AND icon IS NULL;
UPDATE gifts SET icon = '💍' WHERE name = 'Cincin' AND icon IS NULL;
UPDATE gifts SET icon = '🏎️' WHERE name = 'Mobil Sport' AND icon IS NULL;
UPDATE gifts SET icon = '🛥️' WHERE name = 'Kapal Pesiar' AND icon IS NULL;
UPDATE gifts SET icon = '🏰' WHERE name = 'Istana' AND icon IS NULL;
