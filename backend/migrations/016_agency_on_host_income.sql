-- Komisi agency kini 10% dari PENGHASILAN HOST (bukan 10% dari total koin).
-- Hitung ulang catatan lama: komisi baru = penghasilan host pada transaksi itu x komisi agency.
-- Selisihnya dikembalikan ke bagian platform supaya pembukuan tetap seimbang.
CREATE TEMP TABLE agency_fix AS
SELECT ae.id, ae.agency_id, ae.source, ae.ref_type, ae.ref_id, ae.created_at,
       ae.amount AS old_amount,
       FLOOR(l.amount * a.commission_rate)::bigint AS new_amount
FROM agency_earnings ae
JOIN agencies a ON a.id = ae.agency_id
JOIN ledger l ON l.user_id = ae.host_id AND l.currency = 'diamond'
             AND l.reason = ae.source || '_income'
             AND l.ref_type IS NOT DISTINCT FROM ae.ref_type
             AND l.ref_id IS NOT DISTINCT FROM ae.ref_id
             AND l.created_at = ae.created_at;

-- Platform menerima kembali selisih komisi
UPDATE platform_earnings p
SET amount = p.amount + f.old_amount - f.new_amount
FROM agency_fix f
WHERE p.source = f.source
  AND p.ref_type IS NOT DISTINCT FROM f.ref_type
  AND p.ref_id IS NOT DISTINCT FROM f.ref_id
  AND p.created_at = f.created_at;

UPDATE agency_earnings ae SET amount = f.new_amount FROM agency_fix f WHERE ae.id = f.id AND f.new_amount > 0;
DELETE FROM agency_earnings ae USING agency_fix f WHERE ae.id = f.id AND f.new_amount <= 0;

UPDATE agencies a
SET earnings_total = COALESCE((SELECT SUM(amount) FROM agency_earnings WHERE agency_id = a.id), 0);
DROP TABLE agency_fix;
