/**
 * ============================================================================
 * SISTEM AKUNTANSI UTANG DAN PEMBAYARAN - FRONTEND CONTROLLER
 * File: Front End/JS/script.js
 * 
 * Terhubung ke Supabase PostgreSQL melalui @supabase/supabase-js (CDN)
 * dengan opsi fallback otomatis ke Backend Node.js lokal jika aktif.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. KONFIGURASI SUPABASE (Direct Client CDN)
// ----------------------------------------------------------------------------
const SUPABASE_CONFIG = {
    url: 'https://lpyxluyftfwohdjxlanu.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxweXhsdXlmdGZ3b2hkanhsYW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1OTY4MTEsImV4cCI6MjEwNjE3MjgxMX0.wSn4KeWQzRUTHScz6s9heODgh0_eyzj-Dzj_PQy_R7Q'
};

// Inisialisasi Supabase Client
let db = null;
if (window.supabase) {
    db = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
}

// Global Application State
const appState = {
    pelanggan: [],
    produk: [],
    utang: [],
    penjualan: [],
    pembayaran: [],
    activeFilter: 'all',
    searchQuery: ''
};

// ----------------------------------------------------------------------------
// 2. UTILITY FUNCTIONS
// ----------------------------------------------------------------------------
function formatRupiah(number) {
    const val = Number(number) || 0;
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(val);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const d = new Date(dateString);
    return d.toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '✓';
    if (type === 'error') icon = '✕';
    if (type === 'info') icon = 'ℹ';

    toast.innerHTML = `<span><strong>${icon}</strong> ${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ----------------------------------------------------------------------------
// 3. DATA ACCESS LAYER (Supabase with direct fallbacks)
// ----------------------------------------------------------------------------
const api = {
    // Pelanggan
    async getPelanggan() {
        const { data, error } = await db.from('pelanggan').select('*').order('kode_pelanggan', { ascending: true });
        if (error) throw error;
        return data || [];
    },
    async addPelanggan(payload) {
        const { data, error } = await db.from('pelanggan').insert([payload]).select();
        if (error) throw error;
        return data[0];
    },
    async deletePelanggan(id) {
        const { error } = await db.from('pelanggan').delete().eq('id', id);
        if (error) throw error;
    },

    // Produk
    async getProduk() {
        const { data, error } = await db.from('produk').select('*').order('kode_produk', { ascending: true });
        if (error) throw error;
        return data || [];
    },
    async addProduk(payload) {
        const { data, error } = await db.from('produk').insert([payload]).select();
        if (error) throw error;
        return data[0];
    },
    async updateStokProduk(id, newStok) {
        const { error } = await db.from('produk').update({ stok: newStok }).eq('id', id);
        if (error) console.error('Error update stok:', error);
    },
    async deleteProduk(id) {
        const { error } = await db.from('produk').delete().eq('id', id);
        if (error) throw error;
    },

    // Penjualan Kredit & Detail
    async getPenjualan() {
        const { data, error } = await db.from('penjualan').select('*, pelanggan(*)').order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },
    async createPenjualan(penjualanData, items) {
        // 1. Simpan Header Penjualan
        const { data: pj, error: errPj } = await db.from('penjualan').insert([penjualanData]).select();
        if (errPj) throw errPj;
        const penjualanId = pj[0].id;

        // 2. Simpan Detail Items (tanpa subtotal karena generated column)
        const detailPayloads = items.map(item => ({
            penjualan_id: penjualanId,
            produk_id: item.produk_id,
            qty: Number(item.qty),
            harga: Number(item.harga)
        }));

        const { error: errDetail } = await db.from('detail_penjualan').insert(detailPayloads);
        if (errDetail) throw errDetail;

        // 3. Kurangi stok produk masing-masing
        for (const it of items) {
            const prod = appState.produk.find(p => p.id === it.produk_id);
            if (prod) {
                const updatedStok = Math.max(0, (prod.stok || 0) - it.qty);
                await api.updateStokProduk(it.produk_id, updatedStok);
            }
        }

        return pj[0];
    },

    // Detail Lengkap Penjualan
    async getPenjualanDetail(penjualanId) {
        const { data: pj, error: e1 } = await db.from('penjualan').select('*, pelanggan(*)').eq('id', penjualanId).single();
        if (e1) throw e1;
        const { data: details, error: e2 } = await db.from('detail_penjualan').select('*, produk(*)').eq('penjualan_id', penjualanId);
        if (e2) throw e2;
        const { data: bayar, error: e3 } = await db.from('pembayaran').select('*').eq('penjualan_id', penjualanId).order('tanggal_bayar', { ascending: true });
        if (e3) throw e3;
        const { data: utang, error: e4 } = await db.from('v_utang').select('*').eq('id', penjualanId).single();

        return { penjualan: pj, items: details || [], pembayaran: bayar || [], statusUtang: utang || null };
    },

    // Pembayaran
    async getPembayaran() {
        const { data, error } = await db.from('pembayaran').select('*, penjualan(*, pelanggan(*))').order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    },
    async createPembayaran(payload) {
        const { data, error } = await db.from('pembayaran').insert([payload]).select();
        if (error) throw error;
        return data[0];
    },

    // Buku Piutang & Utang (View v_utang)
    async getUtang() {
        const { data, error } = await db.from('v_utang').select('*').order('tanggal', { ascending: false });
        if (error) throw error;
        return data || [];
    }
};

// ----------------------------------------------------------------------------
// 4. CORE APP INITIALIZATION & REFRESH
// ----------------------------------------------------------------------------
async function loadAllData() {
    try {
        const [plg, prd, utg, pmb] = await Promise.all([
            api.getPelanggan(),
            api.getProduk(),
            api.getUtang(),
            api.getPembayaran()
        ]);

        appState.pelanggan = plg;
        appState.produk = prd;
        appState.utang = utg;
        appState.pembayaran = pmb;

        renderDashboard();
        renderUtangTable();
        renderPelangganSelect();
        renderProdukSelectOptions();
        renderPelangganTable();
        renderProdukTable();
        renderPembayaranSelect();
        renderRiwayatPembayaranTable();

    } catch (err) {
        console.error('Error saat memuat data:', err);
        showToast('Gagal memuat data: ' + err.message, 'error');
    }
}

// ----------------------------------------------------------------------------
// 5. DASHBOARD & RINGKASAN AKUNTANSI
// ----------------------------------------------------------------------------
function renderDashboard() {
    let totalPiutang = 0;
    let totalUangMuka = 0;
    let totalPembayaran = 0;
    let totalSisaUtang = 0;
    let countLunas = 0;
    let countSebagian = 0;
    let countBelumLunas = 0;

    appState.utang.forEach(item => {
        totalPiutang += Number(item.total_penjualan || 0);
        totalUangMuka += Number(item.uang_muka || 0);
        totalPembayaran += Number(item.total_pembayaran || 0);
        totalSisaUtang += Number(item.sisa_utang || 0);

        const st = (item.status || '').toLowerCase();
        if (st === 'lunas') countLunas++;
        else if (st === 'sebagian') countSebagian++;
        else countBelumLunas++;
    });

    const totalKasMasuk = totalUangMuka + totalPembayaran;

    // Render metrics
    document.getElementById('metric-total-piutang').textContent = formatRupiah(totalPiutang);
    document.getElementById('metric-total-kas').textContent = formatRupiah(totalKasMasuk);
    document.getElementById('metric-sisa-utang').textContent = formatRupiah(totalSisaUtang);
    document.getElementById('metric-count-transaksi').textContent = appState.utang.length + ' Nota';

    // Status counts
    document.getElementById('stat-count-lunas').textContent = countLunas;
    document.getElementById('stat-count-sebagian').textContent = countSebagian;
    document.getElementById('stat-count-belum').textContent = countBelumLunas;

    // Render recent sales in dashboard table
    const recentTbody = document.getElementById('recent-sales-tbody');
    if (recentTbody) {
        recentTbody.innerHTML = '';
        const recent = appState.utang.slice(0, 5);
        if (recent.length === 0) {
            recentTbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 2rem;">Belum ada transaksi penjualan kredit.</td></tr>`;
            return;
        }

        recent.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${row.nomor_nota}</strong></td>
                <td>${formatDate(row.tanggal)}</td>
                <td>${row.nama_pelanggan} <span style="font-size: 0.75rem; color: #64748b;">(${row.kode_pelanggan})</span></td>
                <td class="text-right">${formatRupiah(row.total_penjualan)}</td>
                <td class="text-right font-bold" style="color: ${row.sisa_utang > 0 ? '#dc2626' : '#059669'};">${formatRupiah(row.sisa_utang)}</td>
                <td class="text-center">${getStatusBadge(row.status)}</td>
                <td class="text-center">
                    <button class="btn btn-secondary btn-sm" onclick="viewDetailNota('${row.id}')">Lihat Rincian</button>
                </td>
            `;
            recentTbody.appendChild(tr);
        });
    }
}

function getStatusBadge(status) {
    const st = (status || '').toLowerCase();
    if (st === 'lunas') {
        return `<span class="badge badge-lunas">✓ Lunas</span>`;
    } else if (st === 'sebagian') {
        return `<span class="badge badge-sebagian">⏳ Sebagian</span>`;
    } else {
        return `<span class="badge badge-belum">⚠ Belum Lunas</span>`;
    }
}

// ----------------------------------------------------------------------------
// 6. BUKU PEMBANTU PIUTANG & UTANG (v_utang)
// ----------------------------------------------------------------------------
function renderUtangTable() {
    const tbody = document.getElementById('utang-table-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    let filtered = [...appState.utang];

    // Filter status tab
    if (appState.activeFilter === 'belum_lunas') {
        filtered = filtered.filter(u => (u.status || '').toLowerCase() === 'belum lunas');
    } else if (appState.activeFilter === 'sebagian') {
        filtered = filtered.filter(u => (u.status || '').toLowerCase() === 'sebagian');
    } else if (appState.activeFilter === 'lunas') {
        filtered = filtered.filter(u => (u.status || '').toLowerCase() === 'lunas');
    }

    // Search query
    if (appState.searchQuery.trim() !== '') {
        const q = appState.searchQuery.toLowerCase();
        filtered = filtered.filter(u => 
            (u.nomor_nota || '').toLowerCase().includes(q) ||
            (u.nama_pelanggan || '').toLowerCase().includes(q) ||
            (u.kode_pelanggan || '').toLowerCase().includes(q)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding: 2.5rem;">Tidak ada catatan utang yang sesuai filter.</td></tr>`;
        return;
    }

    filtered.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${row.nomor_nota}</strong></td>
            <td>${formatDate(row.tanggal)}</td>
            <td>
                <div><strong>${row.nama_pelanggan}</strong></div>
                <div style="font-size: 0.75rem; color: #64748b;">${row.kode_pelanggan}</div>
            </td>
            <td class="text-right">${formatRupiah(row.total_penjualan)}</td>
            <td class="text-right text-muted">${formatRupiah(row.uang_muka)}</td>
            <td class="text-right" style="color: #059669;">${formatRupiah(row.total_pembayaran)}</td>
            <td class="text-right font-bold" style="color: ${row.sisa_utang > 0 ? '#dc2626' : '#059669'};">${formatRupiah(row.sisa_utang)}</td>
            <td class="text-center">${getStatusBadge(row.status)}</td>
            <td class="text-center" style="white-space: nowrap;">
                <button class="btn btn-secondary btn-sm" onclick="viewDetailNota('${row.id}')" title="Lihat Faktur & Histori">📄 Detail</button>
                ${row.sisa_utang > 0 ? `<button class="btn btn-success btn-sm" onclick="quickPay('${row.id}')" style="margin-left: 4px;">💳 Bayar</button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ----------------------------------------------------------------------------
// 7. FORM TRANSAKSI PENJUALAN KREDIT BARU
// ----------------------------------------------------------------------------
function generateNomorNota() {
    const d = new Date();
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100 + Math.random() * 900);
    return `INV-${ymd}-${rand}`;
}

function renderPelangganSelect() {
    const selects = [document.getElementById('penjualan-pelanggan'), document.getElementById('filter-pelanggan-kartu')];
    selects.forEach(select => {
        if (!select) return;
        select.innerHTML = '<option value="">-- Pilih Pelanggan --</option>';
        appState.pelanggan.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.kode_pelanggan} - ${p.nama}`;
            select.appendChild(opt);
        });
    });
}

function renderProdukSelectOptions() {
    // Digunakan saat menambah baris item
}

function addItemRow() {
    const container = document.getElementById('items-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'item-row';
    
    // Build options
    let optionsHtml = '<option value="">-- Pilih Produk / Barang --</option>';
    appState.produk.forEach(p => {
        optionsHtml += `<option value="${p.id}" data-harga="${p.harga}" data-stok="${p.stok}">${p.kode_produk} - ${p.nama_produk} (Stok: ${p.stok})</option>`;
    });

    row.innerHTML = `
        <div>
            <select class="form-control item-produk-select" required onchange="onItemProductChange(this)">
                ${optionsHtml}
            </select>
        </div>
        <div>
            <input type="number" class="form-control text-center item-qty" value="1" min="1" required onchange="calculateInvoiceSummary()" onkeyup="calculateInvoiceSummary()">
        </div>
        <div>
            <input type="number" class="form-control text-right item-harga" value="0" min="0" required onchange="calculateInvoiceSummary()" onkeyup="calculateInvoiceSummary()">
        </div>
        <div>
            <input type="text" class="form-control text-right item-subtotal" value="Rp 0" readonly style="background: #f8fafc; font-weight: 600;">
        </div>
        <div class="text-center">
            <button type="button" class="btn btn-danger btn-icon btn-sm" onclick="removeItemRow(this)" title="Hapus Baris">✕</button>
        </div>
    `;

    container.appendChild(row);
}

function removeItemRow(btn) {
    const container = document.getElementById('items-container');
    if (container.children.length <= 1) {
        showToast('Minimal harus ada 1 baris item produk!', 'error');
        return;
    }
    btn.closest('.item-row').remove();
    calculateInvoiceSummary();
}

function onItemProductChange(selectElem) {
    const selected = selectElem.options[selectElem.selectedIndex];
    const row = selectElem.closest('.item-row');
    const hargaInput = row.querySelector('.item-harga');
    
    if (selected && selected.dataset.harga) {
        hargaInput.value = selected.dataset.harga;
    } else {
        hargaInput.value = 0;
    }
    calculateInvoiceSummary();
}

function calculateInvoiceSummary() {
    const rows = document.querySelectorAll('.item-row');
    let subtotalBelanja = 0;

    rows.forEach(row => {
        const qty = Number(row.querySelector('.item-qty').value) || 0;
        const harga = Number(row.querySelector('.item-harga').value) || 0;
        const subtotal = qty * harga;
        row.querySelector('.item-subtotal').value = formatRupiah(subtotal);
        subtotalBelanja += subtotal;
    });

    const dpInput = document.getElementById('penjualan-dp');
    const dp = Number(dpInput ? dpInput.value : 0) || 0;
    const sisaUtangAwal = Math.max(0, subtotalBelanja - dp);

    document.getElementById('summary-subtotal').textContent = formatRupiah(subtotalBelanja);
    document.getElementById('summary-dp').textContent = formatRupiah(dp);
    document.getElementById('summary-sisa-utang').textContent = formatRupiah(sisaUtangAwal);
}

// Handler Submit Penjualan
async function handlePenjualanSubmit(e) {
    e.preventDefault();

    const nomorNota = document.getElementById('penjualan-nota').value.trim();
    const pelangganId = document.getElementById('penjualan-pelanggan').value;
    const tanggal = document.getElementById('penjualan-tanggal').value;
    const uangMuka = Number(document.getElementById('penjualan-dp').value) || 0;

    if (!pelangganId) {
        showToast('Pilih pelanggan terlebih dahulu!', 'error');
        return;
    }

    const rows = document.querySelectorAll('.item-row');
    const items = [];

    for (const row of rows) {
        const prodId = row.querySelector('.item-produk-select').value;
        const qty = Number(row.querySelector('.item-qty').value) || 0;
        const harga = Number(row.querySelector('.item-harga').value) || 0;

        if (!prodId) {
            showToast('Pilih produk untuk semua baris item!', 'error');
            return;
        }
        if (qty <= 0) {
            showToast('Kuantitas item harus lebih dari 0!', 'error');
            return;
        }

        // Cek stok produk
        const prod = appState.produk.find(p => p.id === prodId);
        if (prod && qty > prod.stok) {
            showToast(`Stok ${prod.nama_produk} tidak mencukupi (Tersisa: ${prod.stok})!`, 'error');
            return;
        }

        items.push({ produk_id: prodId, qty, harga });
    }

    if (items.length === 0) {
        showToast('Tambahkan minimal 1 item produk!', 'error');
        return;
    }

    try {
        const submitBtn = document.getElementById('btn-simpan-penjualan');
        if (submitBtn) submitBtn.disabled = true;

        await api.createPenjualan({
            nomor_nota: nomorNota,
            pelanggan_id: pelangganId,
            tanggal: tanggal || new Date().toISOString().split('T')[0],
            uang_muka: uangMuka
        }, items);

        showToast('Transaksi penjualan kredit berhasil disimpan!');
        
        // Reset form & generate new nota
        document.getElementById('form-penjualan').reset();
        document.getElementById('penjualan-nota').value = generateNomorNota();
        document.getElementById('penjualan-tanggal').valueAsDate = new Date();
        document.getElementById('items-container').innerHTML = '';
        addItemRow();
        calculateInvoiceSummary();

        await loadAllData();
        switchTab('utang');

    } catch (err) {
        console.error('Gagal simpan penjualan:', err);
        showToast('Gagal simpan: ' + err.message, 'error');
    } finally {
        const submitBtn = document.getElementById('btn-simpan-penjualan');
        if (submitBtn) submitBtn.disabled = false;
    }
}

// ----------------------------------------------------------------------------
// 8. TRANSAKSI PEMBAYARAN UTANG
// ----------------------------------------------------------------------------
function renderPembayaranSelect() {
    const select = document.getElementById('bayar-nota-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- Pilih Nota Penjualan yang Berutang --</option>';
    
    // Urutkan yang belum lunas di atas
    const sorted = [...appState.utang].sort((a, b) => {
        if (a.sisa_utang > 0 && b.sisa_utang <= 0) return -1;
        if (a.sisa_utang <= 0 && b.sisa_utang > 0) return 1;
        return 0;
    });

    sorted.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        const statusTxt = u.sisa_utang > 0 ? `Sisa: ${formatRupiah(u.sisa_utang)}` : `Lunas`;
        opt.textContent = `${u.nomor_nota} - ${u.nama_pelanggan} (${statusTxt})`;
        opt.dataset.sisa = u.sisa_utang;
        opt.dataset.pelanggan = u.nama_pelanggan;
        opt.dataset.total = u.total_penjualan;
        opt.dataset.dp = u.uang_muka;
        opt.dataset.terbayar = u.total_pembayaran;
        select.appendChild(opt);
    });
}

function onNotaBayarChange(selectElem) {
    const selected = selectElem.options[selectElem.selectedIndex];
    const infoBox = document.getElementById('bayar-info-box');
    const inputJumlah = document.getElementById('bayar-jumlah');

    if (!selected || !selected.value) {
        if (infoBox) infoBox.style.display = 'none';
        return;
    }

    const sisa = Number(selected.dataset.sisa) || 0;
    const pelanggan = selected.dataset.pelanggan;
    const total = Number(selected.dataset.total) || 0;
    const dp = Number(selected.dataset.dp) || 0;
    const terbayar = Number(selected.dataset.terbayar) || 0;

    document.getElementById('info-bayar-pelanggan').textContent = pelanggan;
    document.getElementById('info-bayar-total').textContent = formatRupiah(total);
    document.getElementById('info-bayar-dp').textContent = formatRupiah(dp);
    document.getElementById('info-bayar-terbayar').textContent = formatRupiah(terbayar);
    document.getElementById('info-bayar-sisa').textContent = formatRupiah(sisa);

    if (infoBox) infoBox.style.display = 'block';

    if (sisa > 0 && inputJumlah) {
        inputJumlah.value = sisa; // Default isi sisa utang
    }
}

function fillLunasAmount() {
    const select = document.getElementById('bayar-nota-select');
    const selected = select.options[select.selectedIndex];
    if (selected && selected.dataset.sisa) {
        document.getElementById('bayar-jumlah').value = selected.dataset.sisa;
    }
}

function quickPay(penjualanId) {
    switchTab('bayar');
    const select = document.getElementById('bayar-nota-select');
    if (select) {
        select.value = penjualanId;
        onNotaBayarChange(select);
    }
}

async function handlePembayaranSubmit(e) {
    e.preventDefault();

    const penjualanId = document.getElementById('bayar-nota-select').value;
    const tanggalBayar = document.getElementById('bayar-tanggal').value;
    const jumlah = Number(document.getElementById('bayar-jumlah').value) || 0;
    const metode = document.getElementById('bayar-metode').value;
    const keterangan = document.getElementById('bayar-keterangan').value.trim();

    if (!penjualanId) {
        showToast('Pilih nota penjualan terlebih dahulu!', 'error');
        return;
    }
    if (jumlah <= 0) {
        showToast('Jumlah pembayaran harus lebih dari 0!', 'error');
        return;
    }

    // Validasi tidak melebihi sisa utang
    const select = document.getElementById('bayar-nota-select');
    const sisaUtang = Number(select.options[select.selectedIndex].dataset.sisa) || 0;
    if (sisaUtang > 0 && jumlah > sisaUtang) {
        if (!confirm(`Jumlah bayar (${formatRupiah(jumlah)}) lebih besar dari sisa utang (${formatRupiah(sisaUtang)}). Lanjutkan?`)) {
            return;
        }
    }

    try {
        const btn = document.getElementById('btn-simpan-bayar');
        if (btn) btn.disabled = true;

        await api.createPembayaran({
            penjualan_id: penjualanId,
            tanggal_bayar: tanggalBayar || new Date().toISOString().split('T')[0],
            jumlah: jumlah,
            metode: metode,
            keterangan: keterangan
        });

        showToast('Pembayaran angsuran/pelunasan berhasil dicatat!');

        // Reset form
        document.getElementById('form-pembayaran').reset();
        document.getElementById('bayar-tanggal').valueAsDate = new Date();
        document.getElementById('bayar-info-box').style.display = 'none';

        await loadAllData();
        switchTab('utang');

    } catch (err) {
        console.error('Gagal mencatat pembayaran:', err);
        showToast('Gagal bayar: ' + err.message, 'error');
    } finally {
        const btn = document.getElementById('btn-simpan-bayar');
        if (btn) btn.disabled = false;
    }
}

function renderRiwayatPembayaranTable() {
    const tbody = document.getElementById('riwayat-bayar-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (appState.pembayaran.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 1.5rem;">Belum ada riwayat pembayaran.</td></tr>`;
        return;
    }

    appState.pembayaran.slice(0, 15).forEach(p => {
        const tr = document.createElement('tr');
        const nota = p.penjualan ? p.penjualan.nomor_nota : '-';
        const pelangganNama = p.penjualan && p.penjualan.pelanggan ? p.penjualan.pelanggan.nama : '-';

        tr.innerHTML = `
            <td><strong>${formatDate(p.tanggal_bayar)}</strong></td>
            <td><strong>${nota}</strong></td>
            <td>${pelangganNama}</td>
            <td class="text-right font-bold" style="color: #059669;">${formatRupiah(p.jumlah)}</td>
            <td><span class="badge" style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe;">${p.metode || 'Transfer'}</span></td>
            <td><span style="font-size: 0.8rem; color: #64748b;">${p.keterangan || '-'}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// ----------------------------------------------------------------------------
// 9. MASTER PELANGGAN
// ----------------------------------------------------------------------------
function renderPelangganTable() {
    const tbody = document.getElementById('pelanggan-table-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (appState.pelanggan.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 2rem;">Belum ada master data pelanggan.</td></tr>`;
        return;
    }

    appState.pelanggan.forEach(p => {
        // Hitung total utang berjalan pelanggan ini dari view v_utang
        const totalUtang = appState.utang
            .filter(u => u.pelanggan_id === p.id)
            .reduce((sum, u) => sum + Number(u.sisa_utang || 0), 0);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${p.kode_pelanggan}</strong></td>
            <td><strong>${p.nama}</strong></td>
            <td>${p.no_hp || '-'}</td>
            <td>${p.alamat || '-'}</td>
            <td class="text-right font-bold" style="color: ${totalUtang > 0 ? '#dc2626' : '#059669'};">${formatRupiah(totalUtang)}</td>
            <td class="text-center">
                <button class="btn btn-secondary btn-sm" onclick="lihatKartuPiutang('${p.id}')">Kartu Piutang</button>
                <button class="btn btn-danger btn-sm" onclick="hapusPelanggan('${p.id}', '${p.nama}')">Hapus</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function handleAddPelanggan(e) {
    e.preventDefault();
    const kode = document.getElementById('modal-plg-kode').value.trim();
    const nama = document.getElementById('modal-plg-nama').value.trim();
    const noHp = document.getElementById('modal-plg-hp').value.trim();
    const alamat = document.getElementById('modal-plg-alamat').value.trim();

    if (!kode || !nama) {
        showToast('Kode dan Nama pelanggan wajib diisi!', 'error');
        return;
    }

    try {
        await api.addPelanggan({ kode_pelanggan: kode, nama, no_hp: noHp, alamat });
        showToast(`Pelanggan ${nama} berhasil ditambahkan!`);
        closeModal('modal-tambah-pelanggan');
        document.getElementById('form-modal-pelanggan').reset();
        await loadAllData();
    } catch (err) {
        showToast('Gagal tambah pelanggan: ' + err.message, 'error');
    }
}

async function hapusPelanggan(id, nama) {
    if (!confirm(`Hapus pelanggan "${nama}"? Semua transaksi dan nota terkait akan terhapus!`)) return;
    try {
        await api.deletePelanggan(id);
        showToast(`Pelanggan "${nama}" berhasil dihapus.`);
        await loadAllData();
    } catch (err) {
        showToast('Gagal hapus pelanggan: ' + err.message, 'error');
    }
}

// ----------------------------------------------------------------------------
// 10. MASTER PRODUK
// ----------------------------------------------------------------------------
function renderProdukTable() {
    const tbody = document.getElementById('produk-table-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (appState.produk.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 2rem;">Belum ada master data produk.</td></tr>`;
        return;
    }

    appState.produk.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${p.kode_produk}</strong></td>
            <td><strong>${p.nama_produk}</strong></td>
            <td class="text-right">${formatRupiah(p.harga)}</td>
            <td class="text-center font-bold" style="color: ${p.stok <= 2 ? '#dc2626' : '#1e293b'};">${p.stok} unit</td>
            <td class="text-center">
                <button class="btn btn-danger btn-sm" onclick="hapusProduk('${p.id}', '${p.nama_produk}')">Hapus</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function handleAddProduk(e) {
    e.preventDefault();
    const kode = document.getElementById('modal-prd-kode').value.trim();
    const nama = document.getElementById('modal-prd-nama').value.trim();
    const harga = Number(document.getElementById('modal-prd-harga').value) || 0;
    const stok = Number(document.getElementById('modal-prd-stok').value) || 0;

    if (!kode || !nama || harga < 0) {
        showToast('Kode, Nama, dan Harga produk wajib diisi dengan benar!', 'error');
        return;
    }

    try {
        await api.addProduk({ kode_produk: kode, nama_produk: nama, harga, stok });
        showToast(`Produk ${nama} berhasil ditambahkan!`);
        closeModal('modal-tambah-produk');
        document.getElementById('form-modal-produk').reset();
        await loadAllData();
    } catch (err) {
        showToast('Gagal tambah produk: ' + err.message, 'error');
    }
}

async function hapusProduk(id, nama) {
    if (!confirm(`Hapus produk "${nama}"?`)) return;
    try {
        await api.deleteProduk(id);
        showToast(`Produk "${nama}" berhasil dihapus.`);
        await loadAllData();
    } catch (err) {
        showToast('Gagal hapus produk: ' + err.message, 'error');
    }
}

// ----------------------------------------------------------------------------
// 11. DETAIL NOTA, KARTU PIUTANG & CETAK FAKTUR
// ----------------------------------------------------------------------------
async function viewDetailNota(penjualanId) {
    try {
        const data = await api.getPenjualanDetail(penjualanId);
        const { penjualan, items, pembayaran, statusUtang } = data;

        const modalBody = document.getElementById('modal-detail-body');
        if (!modalBody) return;

        let itemsRows = '';
        let totalItems = 0;
        items.forEach((it, idx) => {
            const sub = Number(it.subtotal || it.qty * it.harga);
            totalItems += sub;
            itemsRows += `
                <tr>
                    <td class="text-center">${idx + 1}</td>
                    <td><strong>${it.produk ? it.produk.nama_produk : '-'}</strong> <span style="font-size:0.75rem; color:#64748b;">(${it.produk ? it.produk.kode_produk : ''})</span></td>
                    <td class="text-center">${it.qty}</td>
                    <td class="text-right">${formatRupiah(it.harga)}</td>
                    <td class="text-right font-bold">${formatRupiah(sub)}</td>
                </tr>
            `;
        });

        let bayarRows = '';
        if (pembayaran.length === 0) {
            bayarRows = `<tr><td colspan="4" class="text-center text-muted">Belum ada pembayaran angsuran.</td></tr>`;
        } else {
            pembayaran.forEach(b => {
                bayarRows += `
                    <tr>
                        <td>${formatDate(b.tanggal_bayar)}</td>
                        <td>${b.metode || 'Transfer'}</td>
                        <td>${b.keterangan || '-'}</td>
                        <td class="text-right font-bold" style="color: #059669;">${formatRupiah(b.jumlah)}</td>
                    </tr>
                `;
            });
        }

        const dp = Number(penjualan.uang_muka) || 0;
        const totalBayar = pembayaran.reduce((sum, b) => sum + Number(b.jumlah || 0), 0);
        const sisa = statusUtang ? Number(statusUtang.sisa_utang) : Math.max(0, totalItems - dp - totalBayar);
        const status = statusUtang ? statusUtang.status : (sisa <= 0 ? 'Lunas' : 'Belum Lunas');

        modalBody.innerHTML = `
            <div id="printable-area">
                <div style="border-bottom: 2px solid #1e293b; padding-bottom: 1rem; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h2 style="font-size: 1.35rem; color: #1e40af; margin-bottom: 0.25rem;">FAKTUR PENJUALAN KREDIT</h2>
                        <div style="font-size: 0.85rem; color: #64748b;">Sistem Akuntansi Utang & Pembayaran</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 1.15rem; font-weight: 700;">${penjualan.nomor_nota}</div>
                        <div style="font-size: 0.85rem; color: #64748b;">Tanggal: ${formatDate(penjualan.tanggal)}</div>
                        <div style="margin-top: 0.35rem;">${getStatusBadge(status)}</div>
                    </div>
                </div>

                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem;">
                    <div style="font-size: 0.8rem; font-weight: 600; color: #64748b; text-transform: uppercase;">Informasi Pelanggan (Debitur):</div>
                    <div style="font-size: 1rem; font-weight: 700; color: #0f172a; margin-top: 0.25rem;">${penjualan.pelanggan ? penjualan.pelanggan.nama : '-'} (${penjualan.pelanggan ? penjualan.pelanggan.kode_pelanggan : ''})</div>
                    <div style="font-size: 0.85rem; color: #475569;">No. Telp / HP: ${penjualan.pelanggan && penjualan.pelanggan.no_hp ? penjualan.pelanggan.no_hp : '-'}</div>
                    <div style="font-size: 0.85rem; color: #475569;">Alamat: ${penjualan.pelanggan && penjualan.pelanggan.alamat ? penjualan.pelanggan.alamat : '-'}</div>
                </div>

                <h4 style="font-size: 0.95rem; margin-bottom: 0.5rem; color: #334155;">Rincian Barang yang Dibeli:</h4>
                <div class="table-responsive" style="margin-bottom: 1.25rem;">
                    <table class="table">
                        <thead>
                            <tr>
                                <th class="text-center" style="width: 40px;">No</th>
                                <th>Nama Produk</th>
                                <th class="text-center" style="width: 80px;">Qty</th>
                                <th class="text-right" style="width: 140px;">Harga Satuan</th>
                                <th class="text-right" style="width: 140px;">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>${itemsRows}</tbody>
                    </table>
                </div>

                <div style="display: flex; justify-content: flex-end; margin-bottom: 1.5rem;">
                    <div style="width: 320px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem;">
                        <div class="summary-row"><span>Total Penjualan:</span><strong>${formatRupiah(totalItems)}</strong></div>
                        <div class="summary-row"><span>Uang Muka (DP):</span><strong style="color: #059669;">- ${formatRupiah(dp)}</strong></div>
                        <div class="summary-row"><span>Total Pembayaran Angsuran:</span><strong style="color: #059669;">- ${formatRupiah(totalBayar)}</strong></div>
                        <div class="summary-row total-row debt-row"><span>Sisa Utang:</span><span>${formatRupiah(sisa)}</span></div>
                    </div>
                </div>

                <h4 style="font-size: 0.95rem; margin-bottom: 0.5rem; color: #334155;">Catatan Riwayat Pembayaran / Pelunasan:</h4>
                <div class="table-responsive" style="margin-bottom: 1rem;">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Tanggal Bayar</th>
                                <th>Metode</th>
                                <th>Keterangan</th>
                                <th class="text-right">Jumlah Dibayar</th>
                            </tr>
                        </thead>
                        <tbody>${bayarRows}</tbody>
                    </table>
                </div>
            </div>
        `;

        openModal('modal-detail-nota');

    } catch (err) {
        showToast('Gagal memuat rincian nota: ' + err.message, 'error');
    }
}

function lihatKartuPiutang(pelangganId) {
    const plg = appState.pelanggan.find(p => p.id === pelangganId);
    if (!plg) return;

    const notaList = appState.utang.filter(u => u.pelanggan_id === pelangganId);
    const modalBody = document.getElementById('modal-kartu-body');
    if (!modalBody) return;

    let rowsHtml = '';
    let totalBeli = 0;
    let totalDP = 0;
    let totalBayar = 0;
    let totalSisa = 0;

    if (notaList.length === 0) {
        rowsHtml = `<tr><td colspan="7" class="text-center text-muted">Pelanggan ini belum memiliki riwayat transaksi kredit.</td></tr>`;
    } else {
        notaList.forEach(u => {
            totalBeli += Number(u.total_penjualan || 0);
            totalDP += Number(u.uang_muka || 0);
            totalBayar += Number(u.total_pembayaran || 0);
            totalSisa += Number(u.sisa_utang || 0);

            rowsHtml += `
                <tr>
                    <td><strong>${u.nomor_nota}</strong></td>
                    <td>${formatDate(u.tanggal)}</td>
                    <td class="text-right">${formatRupiah(u.total_penjualan)}</td>
                    <td class="text-right">${formatRupiah(u.uang_muka)}</td>
                    <td class="text-right" style="color: #059669;">${formatRupiah(u.total_pembayaran)}</td>
                    <td class="text-right font-bold" style="color: ${u.sisa_utang > 0 ? '#dc2626' : '#059669'};">${formatRupiah(u.sisa_utang)}</td>
                    <td class="text-center">${getStatusBadge(u.status)}</td>
                </tr>
            `;
        });
    }

    modalBody.innerHTML = `
        <div id="printable-kartu">
            <div style="border-bottom: 2px solid #1e293b; padding-bottom: 0.75rem; margin-bottom: 1.25rem;">
                <h3 style="color: #1e40af; margin-bottom: 0.25rem;">KARTU PIUTANG PELANGGAN</h3>
                <div style="font-size: 1.1rem; font-weight: 700;">${plg.nama} (${plg.kode_pelanggan})</div>
                <div style="font-size: 0.85rem; color: #64748b;">No HP: ${plg.no_hp || '-'} | Alamat: ${plg.alamat || '-'}</div>
            </div>

            <div class="metrics-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 1.25rem;">
                <div class="metric-card" style="padding: 0.75rem 1rem;">
                    <div class="metric-title">Total Penjualan</div>
                    <div style="font-size: 1.2rem; font-weight: 700;">${formatRupiah(totalBeli)}</div>
                </div>
                <div class="metric-card" style="padding: 0.75rem 1rem;">
                    <div class="metric-title">Total Terbayar (DP + Angsuran)</div>
                    <div style="font-size: 1.2rem; font-weight: 700; color: #059669;">${formatRupiah(totalDP + totalBayar)}</div>
                </div>
                <div class="metric-card" style="padding: 0.75rem 1rem;">
                    <div class="metric-title">Sisa Utang Berjalan</div>
                    <div style="font-size: 1.2rem; font-weight: 700; color: #dc2626;">${formatRupiah(totalSisa)}</div>
                </div>
            </div>

            <div class="table-responsive">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Nomor Nota</th>
                            <th>Tanggal</th>
                            <th class="text-right">Penjualan</th>
                            <th class="text-right">Uang Muka</th>
                            <th class="text-right">Total Bayar</th>
                            <th class="text-right">Sisa Utang</th>
                            <th class="text-center">Status</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </div>
    `;

    openModal('modal-kartu-piutang');
}

function printDocument() {
    window.print();
}

// ----------------------------------------------------------------------------
// 12. TAB NAVIGATION & MODAL CONTROLLERS
// ----------------------------------------------------------------------------
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabId}`);
    });
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

// ----------------------------------------------------------------------------
// 13. DOM READY & EVENT LISTENERS
// ----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Filter status buttons in Buku Utang
    document.querySelectorAll('.filter-status-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-status-btn').forEach(b => b.classList.remove('btn-primary'));
            document.querySelectorAll('.filter-status-btn').forEach(b => b.classList.add('btn-secondary'));
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
            appState.activeFilter = btn.dataset.filter;
            renderUtangTable();
        });
    });

    // Search bar filter
    const searchInput = document.getElementById('search-utang');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            appState.searchQuery = e.target.value;
            renderUtangTable();
        });
    }

    // Modal background click to close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });

    // Setup initial sale form
    const notaInput = document.getElementById('penjualan-nota');
    if (notaInput) notaInput.value = generateNomorNota();

    const tglInput = document.getElementById('penjualan-tanggal');
    if (tglInput) tglInput.valueAsDate = new Date();

    const bayarTgl = document.getElementById('bayar-tanggal');
    if (bayarTgl) bayarTgl.valueAsDate = new Date();

    // Add first item row
    addItemRow();

    // Attach form submit handlers
    const formPenjualan = document.getElementById('form-penjualan');
    if (formPenjualan) formPenjualan.addEventListener('submit', handlePenjualanSubmit);

    const formBayar = document.getElementById('form-pembayaran');
    if (formBayar) formBayar.addEventListener('submit', handlePembayaranSubmit);

    const formModalPlg = document.getElementById('form-modal-pelanggan');
    if (formModalPlg) formModalPlg.addEventListener('submit', handleAddPelanggan);

    const formModalPrd = document.getElementById('form-modal-produk');
    if (formModalPrd) formModalPrd.addEventListener('submit', handleAddProduk);

    // Initial load from Supabase
    loadAllData();
});
