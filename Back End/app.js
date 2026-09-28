/**
 * ============================================================================
 * SISTEM AKUNTANSI UTANG DAN PEMBAYARAN - BACKEND SERVER
 * File: Back End/app.js
 * 
 * Server backend mandiri menggunakan modul bawaan Node.js (http, fs, path, url)
 * dan Native Fetch (Node.js 18+). Berjalan TANPA package.json dan TANPA file .env.
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ----------------------------------------------------------------------------
// 1. KONFIGURASI SUPABASE (Sesuai kredensial yang diberikan)
// ----------------------------------------------------------------------------
const SUPABASE_CONFIG = {
    url: 'https://lpyxluyftfwohdjxlanu.supabase.co',
    publishableKey: 'sb_publishable_WP1Yn3yNEGCG6qYOpvT7qw_PJSYI1kE',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxweXhsdXlmdGZ3b2hkanhsYW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1OTY4MTEsImV4cCI6MjEwNjE3MjgxMX0.wSn4KeWQzRUTHScz6s9heODgh0_eyzj-Dzj_PQy_R7Q',
};

const PORT = process.env.PORT || 3000;

// Base headers untuk koneksi ke Supabase PostgREST
function getSupabaseHeaders(useServiceRole = true) {
    const key = useServiceRole ? SUPABASE_CONFIG.serviceRoleKey : SUPABASE_CONFIG.anonKey;
    return {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    };
}

// Helper untuk fetch ke Supabase PostgREST
async function supabaseFetch(endpoint, options = {}) {
    const fullUrl = `${SUPABASE_CONFIG.url}/rest/v1/${endpoint}`;
    const headers = { ...getSupabaseHeaders(true), ...(options.headers || {}) };
    
    const response = await fetch(fullUrl, {
        ...options,
        headers
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase Error (${response.status}): ${errorText}`);
    }

    if (response.status === 204) return null; // No Content
    return await response.json();
}

// ----------------------------------------------------------------------------
// 2. HELPER UTILITY HTTP
// ----------------------------------------------------------------------------
function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey'
    });
    res.end(JSON.stringify(data));
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error('Format JSON tidak valid'));
            }
        });
        req.on('error', reject);
    });
}

// ----------------------------------------------------------------------------
// 3. STATIC FILE SERVER (Menyajikan Front End HTML, CSS, JS)
// ----------------------------------------------------------------------------
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function serveStaticFile(req, res, pathname) {
    const projectRoot = path.join(__dirname, '..');
    let filePath = '';

    if (pathname === '/' || pathname === '/index.html') {
        filePath = path.join(projectRoot, 'Front End', 'HTML', 'index.html');
    } else if (pathname.startsWith('/CSS/')) {
        filePath = path.join(projectRoot, 'Front End', pathname);
    } else if (pathname.startsWith('/JS/')) {
        filePath = path.join(projectRoot, 'Front End', pathname);
    } else if (pathname.startsWith('/HTML/')) {
        filePath = path.join(projectRoot, 'Front End', pathname);
    } else {
        filePath = path.join(projectRoot, pathname);
    }

    // Cek jika file ada
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

// ----------------------------------------------------------------------------
// 4. ROUTER API BACKEND
// ----------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey'
        });
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    try {
        // --- 4.1 STATUS & CONFIG API ---
        if (pathname === '/api/health' && method === 'GET') {
            return sendJSON(res, 200, { status: 'OK', message: 'Sistem Akuntansi Utang & Pembayaran Aktif' });
        }

        if (pathname === '/api/config' && method === 'GET') {
            return sendJSON(res, 200, {
                supabaseUrl: SUPABASE_CONFIG.url,
                anonKey: SUPABASE_CONFIG.anonKey,
                publishableKey: SUPABASE_CONFIG.publishableKey
            });
        }

        // --- 4.2 MASTER PELANGGAN ---
        if (pathname === '/api/pelanggan') {
            if (method === 'GET') {
                const data = await supabaseFetch('pelanggan?order=kode_pelanggan.asc');
                return sendJSON(res, 200, data);
            }
            if (method === 'POST') {
                const body = await parseBody(req);
                if (!body.kode_pelanggan || !body.nama) {
                    return sendJSON(res, 400, { error: 'Kode pelanggan dan Nama wajib diisi' });
                }
                const inserted = await supabaseFetch('pelanggan', {
                    method: 'POST',
                    body: JSON.stringify(body)
                });
                return sendJSON(res, 201, inserted[0]);
            }
        }

        if (pathname.startsWith('/api/pelanggan/') && method === 'DELETE') {
            const id = pathname.split('/')[3];
            await supabaseFetch(`pelanggan?id=eq.${id}`, { method: 'DELETE' });
            return sendJSON(res, 200, { success: true, message: 'Pelanggan berhasil dihapus' });
        }

        // --- 4.3 MASTER PRODUK ---
        if (pathname === '/api/produk') {
            if (method === 'GET') {
                const data = await supabaseFetch('produk?order=kode_produk.asc');
                return sendJSON(res, 200, data);
            }
            if (method === 'POST') {
                const body = await parseBody(req);
                if (!body.kode_produk || !body.nama_produk || body.harga === undefined) {
                    return sendJSON(res, 400, { error: 'Kode, Nama, dan Harga produk wajib diisi' });
                }
                const inserted = await supabaseFetch('produk', {
                    method: 'POST',
                    body: JSON.stringify(body)
                });
                return sendJSON(res, 201, inserted[0]);
            }
        }

        if (pathname.startsWith('/api/produk/') && method === 'DELETE') {
            const id = pathname.split('/')[3];
            await supabaseFetch(`produk?id=eq.${id}`, { method: 'DELETE' });
            return sendJSON(res, 200, { success: true, message: 'Produk berhasil dihapus' });
        }

        // --- 4.4 TRANSAKSI PENJUALAN KREDIT (PEMBUATAN NOTA & RINCIAN) ---
        if (pathname === '/api/penjualan') {
            if (method === 'GET') {
                const data = await supabaseFetch('penjualan?order=created_at.desc');
                return sendJSON(res, 200, data);
            }
            if (method === 'POST') {
                const body = await parseBody(req);
                const { nomor_nota, pelanggan_id, tanggal, uang_muka, items } = body;

                if (!nomor_nota || !pelanggan_id || !items || !items.length) {
                    return sendJSON(res, 400, { error: 'Nomor nota, Pelanggan, dan minimal 1 item produk wajib diisi' });
                }

                // 1. Simpan header penjualan
                const penjualanPayload = {
                    nomor_nota,
                    pelanggan_id,
                    tanggal: tanggal || new Date().toISOString().split('T')[0],
                    uang_muka: Number(uang_muka) || 0
                };

                const createdPenjualan = await supabaseFetch('penjualan', {
                    method: 'POST',
                    body: JSON.stringify(penjualanPayload)
                });
                const penjualanId = createdPenjualan[0].id;

                // 2. Simpan rincian barang (detail_penjualan) & kurangi stok produk
                for (const item of items) {
                    const detailPayload = {
                        penjualan_id: penjualanId,
                        produk_id: item.produk_id,
                        qty: Number(item.qty),
                        harga: Number(item.harga)
                        // Catatan: subtotal dihitung otomatis oleh Postgres (GENERATED ALWAYS)
                    };
                    await supabaseFetch('detail_penjualan', {
                        method: 'POST',
                        body: JSON.stringify(detailPayload)
                    });

                    // Kurangi stok produk
                    try {
                        const produkList = await supabaseFetch(`produk?id=eq.${item.produk_id}`);
                        if (produkList && produkList.length > 0) {
                            const newStok = Math.max(0, (produkList[0].stok || 0) - item.qty);
                            await supabaseFetch(`produk?id=eq.${item.produk_id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ stok: newStok })
                            });
                        }
                    } catch (stokErr) {
                        console.error('Update stok warning:', stokErr.message);
                    }
                }

                return sendJSON(res, 201, {
                    success: true,
                    message: 'Penjualan kredit berhasil dicatat',
                    penjualan: createdPenjualan[0]
                });
            }
        }

        // Ambil detail lengkap 1 penjualan beserta item dan histori pembayarannya
        if (pathname.match(/^\/api\/penjualan\/[a-f0-9-]+\/detail$/) && method === 'GET') {
            const id = pathname.split('/')[3];
            const [penjualan] = await supabaseFetch(`penjualan?id=eq.${id}&select=*,pelanggan(*)`);
            const details = await supabaseFetch(`detail_penjualan?penjualan_id=eq.${id}&select=*,produk(*)`);
            const pembayaranList = await supabaseFetch(`pembayaran?penjualan_id=eq.${id}&order=tanggal_bayar.asc`);
            const [statusUtang] = await supabaseFetch(`v_utang?id=eq.${id}`);

            return sendJSON(res, 200, {
                penjualan,
                items: details,
                pembayaran: pembayaranList,
                statusUtang
            });
        }

        // --- 4.5 TRANSAKSI PEMBAYARAN ANGSURAN / PELUNASAN ---
        if (pathname === '/api/pembayaran') {
            if (method === 'GET') {
                const data = await supabaseFetch('pembayaran?order=created_at.desc');
                return sendJSON(res, 200, data);
            }
            if (method === 'POST') {
                const body = await parseBody(req);
                const { penjualan_id, tanggal_bayar, jumlah, metode, keterangan } = body;

                if (!penjualan_id || !jumlah || Number(jumlah) <= 0) {
                    return sendJSON(res, 400, { error: 'Penjualan ID dan jumlah pembayaran yang valid wajib diisi' });
                }

                const bayarPayload = {
                    penjualan_id,
                    tanggal_bayar: tanggal_bayar || new Date().toISOString().split('T')[0],
                    jumlah: Number(jumlah),
                    metode: metode || 'Transfer',
                    keterangan: keterangan || ''
                };

                const createdBayar = await supabaseFetch('pembayaran', {
                    method: 'POST',
                    body: JSON.stringify(bayarPayload)
                });

                // Ambil status utang terbaru setelah pembayaran
                const [updatedUtang] = await supabaseFetch(`v_utang?id=eq.${penjualan_id}`);

                return sendJSON(res, 201, {
                    success: true,
                    message: 'Pembayaran berhasil dicatat',
                    pembayaran: createdBayar[0],
                    statusUtang: updatedUtang
                });
            }
        }

        // --- 4.6 BUKU PEMBANTU PIUTANG / STATUS UTANG (VIEW v_utang) ---
        if (pathname === '/api/utang' && method === 'GET') {
            const data = await supabaseFetch('v_utang?order=tanggal.desc');
            return sendJSON(res, 200, data);
        }

        // --- 4.7 RINGKASAN AKUNTANSI (DASHBOARD) ---
        if (pathname === '/api/ringkasan' && method === 'GET') {
            const utangList = await supabaseFetch('v_utang');
            
            let totalPiutang = 0;
            let totalUangMuka = 0;
            let totalPembayaran = 0;
            let totalSisaUtang = 0;
            let countLunas = 0;
            let countSebagian = 0;
            let countBelumLunas = 0;

            utangList.forEach(item => {
                totalPiutang += Number(item.total_penjualan || 0);
                totalUangMuka += Number(item.uang_muka || 0);
                totalPembayaran += Number(item.total_pembayaran || 0);
                totalSisaUtang += Number(item.sisa_utang || 0);

                const st = (item.status || '').toLowerCase();
                if (st === 'lunas') countLunas++;
                else if (st === 'sebagian') countSebagian++;
                else countBelumLunas++;
            });

            return sendJSON(res, 200, {
                totalPenjualanKredit: totalPiutang,
                totalUangMuka: totalUangMuka,
                totalPenerimaanBayar: totalPembayaran,
                totalPenerimaanKas: totalUangMuka + totalPembayaran,
                totalSisaPiutang: totalSisaUtang,
                totalTransaksi: utangList.length,
                jumlahLunas: countLunas,
                jumlahSebagian: countSebagian,
                jumlahBelumLunas: countBelumLunas
            });
        }

        // --- JIKA TIDAK COCOK DENGAN ENDPOINT API -> SAJIKAN FILE FRONT END ---
        return serveStaticFile(req, res, pathname);

    } catch (err) {
        console.error('Server Error:', err);
        return sendJSON(res, 500, { error: err.message });
    }
});

// Jalankan Server
server.listen(PORT, () => {
    console.log('============================================================');
    console.log(` SISTEM AKUNTANSI UTANG DAN PEMBAYARAN `);
    console.log(` Server aktif di: http://localhost:${PORT}`);
    console.log(` Terhubung ke Supabase: ${SUPABASE_CONFIG.url}`);
    console.log('============================================================');
});
