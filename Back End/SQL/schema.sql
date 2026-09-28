-- ============================================================================
-- SISTEM AKUNTANSI UTANG DAN PEMBAYARAN
-- Database Schema: PostgreSQL (Supabase)
-- ERD 5 Entitas: pelanggan, produk, penjualan, detail_penjualan, pembayaran
-- ============================================================================

-- 1. EXTENSION
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 2. TABEL: pelanggan (Master Data Pelanggan / Debitur)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pelanggan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode_pelanggan VARCHAR(20) NOT NULL UNIQUE,
    nama VARCHAR(100) NOT NULL,
    no_hp VARCHAR(20),
    alamat TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 3. TABEL: produk (Master Data Barang / Produk)
-- ============================================================================
CREATE TABLE IF NOT EXISTS produk (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode_produk VARCHAR(20) NOT NULL UNIQUE,
    nama_produk VARCHAR(100) NOT NULL,
    harga NUMERIC(15, 2) NOT NULL CHECK (harga >= 0),
    stok INT NOT NULL DEFAULT 0 CHECK (stok >= 0),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 4. TABEL: penjualan (Header Transaksi Penjualan Kredit / Faktur Piutang)
-- ============================================================================
CREATE TABLE IF NOT EXISTS penjualan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nomor_nota VARCHAR(30) NOT NULL UNIQUE,
    pelanggan_id UUID NOT NULL REFERENCES pelanggan(id) ON DELETE CASCADE,
    tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
    uang_muka NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (uang_muka >= 0),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 5. TABEL: detail_penjualan (Rincian Item Barang yang Dijual)
-- ============================================================================
CREATE TABLE IF NOT EXISTS detail_penjualan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    penjualan_id UUID NOT NULL REFERENCES penjualan(id) ON DELETE CASCADE,
    produk_id UUID NOT NULL REFERENCES produk(id),
    qty INT NOT NULL CHECK (qty > 0),
    harga NUMERIC(15, 2) NOT NULL CHECK (harga >= 0),
    subtotal NUMERIC(15, 2) GENERATED ALWAYS AS (qty * harga) STORED
);

-- ============================================================================
-- 6. TABEL: pembayaran (Catatan Pembayaran / Angsuran / Pelunasan Piutang)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pembayaran (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    penjualan_id UUID NOT NULL REFERENCES penjualan(id) ON DELETE CASCADE,
    tanggal_bayar DATE NOT NULL DEFAULT CURRENT_DATE,
    jumlah NUMERIC(15, 2) NOT NULL CHECK (jumlah > 0),
    metode VARCHAR(30) DEFAULT 'Transfer',
    keterangan TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- 7. INDEX UNTUK PERFORMA QUERY & RELASI
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_penjualan_pelanggan ON penjualan(pelanggan_id);
CREATE INDEX IF NOT EXISTS idx_penjualan_tanggal ON penjualan(tanggal);
CREATE INDEX IF NOT EXISTS idx_detail_penjualan_id ON detail_penjualan(penjualan_id);
CREATE INDEX IF NOT EXISTS idx_detail_produk_id ON detail_penjualan(produk_id);
CREATE INDEX IF NOT EXISTS idx_pembayaran_penjualan ON pembayaran(penjualan_id);
CREATE INDEX IF NOT EXISTS idx_pembayaran_tanggal ON pembayaran(tanggal_bayar);

-- ============================================================================
-- 8. VIEW: v_utang (Buku Pembantu Piutang & Perhitungan Otomatis Sisa Utang)
-- ============================================================================
CREATE OR REPLACE VIEW v_utang AS
SELECT 
    p.id,
    p.nomor_nota,
    p.tanggal,
    p.pelanggan_id,
    plg.kode_pelanggan,
    plg.nama AS nama_pelanggan,
    COALESCE(dp.total_penjualan, 0) AS total_penjualan,
    p.uang_muka,
    COALESCE(pb.total_pembayaran, 0) AS total_pembayaran,
    GREATEST(0, (COALESCE(dp.total_penjualan, 0) - p.uang_muka - COALESCE(pb.total_pembayaran, 0))) AS sisa_utang,
    CASE 
        WHEN (COALESCE(dp.total_penjualan, 0) - p.uang_muka - COALESCE(pb.total_pembayaran, 0)) <= 0 THEN 'Lunas'
        WHEN COALESCE(pb.total_pembayaran, 0) > 0 OR p.uang_muka > 0 THEN 'Sebagian'
        ELSE 'Belum Lunas'
    END AS status
FROM penjualan p
JOIN pelanggan plg ON p.pelanggan_id = plg.id
LEFT JOIN (
    SELECT penjualan_id, SUM(qty * harga) AS total_penjualan
    FROM detail_penjualan
    GROUP BY penjualan_id
) dp ON p.id = dp.penjualan_id
LEFT JOIN (
    SELECT penjualan_id, SUM(jumlah) AS total_pembayaran
    FROM pembayaran
    GROUP BY penjualan_id
) pb ON p.id = pb.penjualan_id;

-- ============================================================================
-- 9. TRIGGER: PENGURANGAN OTOMATIS STOK PRODUK SAAT PENJUALAN
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_kurangi_stok_produk()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE produk
    SET stok = stok - NEW.qty
    WHERE id = NEW.produk_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kurangi_stok ON detail_penjualan;
CREATE TRIGGER trg_kurangi_stok
AFTER INSERT ON detail_penjualan
FOR EACH ROW
EXECUTE FUNCTION fn_kurangi_stok_produk();

-- ============================================================================
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- Supaya API frontend dan backend dapat mengakses data secara aman
-- ============================================================================
ALTER TABLE pelanggan ENABLE ROW LEVEL SECURITY;
ALTER TABLE produk ENABLE ROW LEVEL SECURITY;
ALTER TABLE penjualan ENABLE ROW LEVEL SECURITY;
ALTER TABLE detail_penjualan ENABLE ROW LEVEL SECURITY;
ALTER TABLE pembayaran ENABLE ROW LEVEL SECURITY;

-- Buat policy publik untuk membaca & menulis data
DROP POLICY IF EXISTS "Public Pelanggan" ON pelanggan;
CREATE POLICY "Public Pelanggan" ON pelanggan FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Produk" ON produk;
CREATE POLICY "Public Produk" ON produk FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Penjualan" ON penjualan;
CREATE POLICY "Public Penjualan" ON penjualan FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Detail Penjualan" ON detail_penjualan;
CREATE POLICY "Public Detail Penjualan" ON detail_penjualan FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Pembayaran" ON pembayaran;
CREATE POLICY "Public Pembayaran" ON pembayaran FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 11. DATA AWAL (SEED DATA)
-- ============================================================================
INSERT INTO pelanggan (kode_pelanggan, nama, no_hp, alamat)
VALUES 
    ('PLG001', 'Andi Pratama', '081234567890', 'Tembalang, Semarang'),
    ('PLG002', 'Siti Rahma', '082233445566', 'Banyumanik, Semarang')
ON CONFLICT (kode_pelanggan) DO NOTHING;

INSERT INTO produk (kode_produk, nama_produk, harga, stok)
VALUES 
    ('PRD001', 'Meja Makan Jati', 4500000.00, 5),
    ('PRD002', 'Kursi Tamu Minimalis', 2800000.00, 8),
    ('PRD003', 'Lemari 3 Pintu', 5200000.00, 4),
    ('PRD004', 'Rak Buku Kayu', 1800000.00, 10)
ON CONFLICT (kode_produk) DO NOTHING;
