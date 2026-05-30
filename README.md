# Mobile Pearl Wallet

Dompet (wallet) **non-custodial** untuk **Pearl L1 (PRL)** dalam bentuk aplikasi
Android (APK) + PWA. Dibangun di atas [PearlBridgeXYZ/pearlwallet](https://github.com/PearlBridgeXYZ/pearlwallet)
— **derivasi BIP-39, penandatanganan (signing), dan WebWorker kripto-nya dipakai
ulang apa adanya (verbatim)**, tanpa ditulis ulang. Yang ditambahkan hanya UI +
fitur: rebrand, Receive terkunci, tip developer, multi-akun, dan multi-send.

> **Catatan kunci soal kripto.** Pearl L1 di sini adalah turunan btcd/Bitcoin
> yang memakai **Taproot (BIP-86) + tanda tangan Schnorr BIP-340 (secp256k1)** dan
> berbasis **UTXO**. Tanda tangannya **stateless** — **tidak ada XMSS**, tidak ada
> "one-time key" yang harus dimajukan, jadi **tidak ada risiko kebocoran kunci
> akibat pemakaian indeks berulang**. Lihat bagian [Soal keamanan](#soal-keamanan-penting).

---

## Daftar isi

- [Fitur](#fitur)
- [Cara Pakai (Tutorial)](#cara-pakai)
  - [1. Pasang / sideload APK](#1-pasang--sideload-apk)
  - [2. Buat atau impor akun](#2-buat-atau-impor-akun)
  - [3. Menerima PRL (Receive)](#3-menerima-prl-receive)
  - [4. Mengirim PRL — dengan / tanpa tip](#4-mengirim-prl--dengan--tanpa-tip)
  - [5. Multi-send (kirim ke banyak alamat sekaligus)](#5-multi-send)
  - [6. Merge (kumpulkan semua PRL ke 1 wallet)](#6-merge-kumpulkan-semua-prl-ke-1-wallet)
  - [7. Multi-akun (ganti akun)](#7-multi-akun)
  - [8. Pengaturan tip](#8-pengaturan-tip)
- [Soal keamanan (penting)](#soal-keamanan-penting)
- [Build dari source](#build-dari-source)
- [Apa yang dipakai-ulang vs ditambahkan](#apa-yang-dipakai-ulang-vs-ditambahkan)

---

## Fitur

| Fitur | Keterangan |
|---|---|
| **Rebrand** | Nama "Mobile Pearl Wallet", logo motif kerang + mutiara (palet warna Pearl). |
| **Receive terkunci** | Hanya menampilkan **satu** alamat `prl1...` utama per akun + QR + tombol salin. Tidak pernah membuat alamat acak. |
| **Send + tip opsional** | Setiap pengiriman menampilkan checkbox "Send 0.5 PRL tip to support the dev" (**dicentang secara default**, bisa dimatikan). |
| **Multi-akun** | Impor/restore banyak akun dari seed phrase, lihat daftarnya, ganti akun aktif (gaya Zano). |
| **Multi-send** | Kirim ke banyak penerima dalam **satu transaksi** (gaya batch OKX). |
| **Merge** | Kumpulkan **seluruh saldo PRL** lalu kirim (sweep) ke **satu wallet tujuan** — alamat sendiri atau wallet mana saja. **Wajib** menyertakan tip developer **0.1 PRL** per merge (tidak bisa dimatikan). |
| **Aman & ringan** | Auto-lock, ekspor seed auto-hide, RPC allowlist + CSP bawaan dipertahankan. Semua RPC/signing dibungkus try/catch — tidak crash saat jaringan gagal. |

---

## Cara Pakai

### 1. Pasang / sideload APK

1. Unduh berkas **`dist/mobile-pearl-wallet.apk`** dari repo ini ke ponsel Android.
2. Di ponsel, buka **Settings → Apps → Special access → Install unknown apps**
   (atau saat membuka APK akan muncul prompt), lalu **izinkan** browser/file
   manager yang dipakai untuk memasang aplikasi.
3. Buka berkas APK → ketuk **Install** → **Open**.
4. APK ini **debug-signed** (untuk sideload/uji coba). Android mungkin menampilkan
   peringatan "aplikasi dari sumber tak dikenal" — itu wajar untuk APK di luar
   Play Store.

> Alternatif tanpa pasang APK: jalankan versi web/PWA (lihat
> [Build dari source](#build-dari-source)) lalu "Add to Home screen".

### 2. Buat atau impor akun

**Buat baru:**
1. Buka aplikasi → **Create a new wallet**.
2. **Catat 12 kata seed phrase** di kertas (jangan screenshot, jangan simpan di
   cloud). Tunggu beberapa detik lalu **I've written it down**.
3. Verifikasi kata ke-3, 7, dan 11.
4. Buat **password** untuk membuka kunci di perangkat ini, centang pernyataan,
   lalu **Create wallet**.

**Impor dari seed phrase yang sudah ada:** lihat [Multi-akun](#6-multi-akun) —
caranya sama, lewat tombol **Import another account**.

> ⚠️ **Jangan pernah** membagikan seed phrase. Siapa pun yang punya 12/24 kata itu
> menguasai dana Anda. Aplikasi ini **tidak pernah** mengirim seed/kunci ke mana
> pun — semuanya tersimpan terenkripsi di perangkat.

### 3. Menerima PRL (Receive)

1. Dari Dashboard, ketuk **Receive**.
2. Layar menampilkan **satu alamat `prl1...` tetap** milik akun aktif + **QR code**.
3. Ketuk **Copy address** untuk menyalin, atau minta pengirim memindai QR.

Alamat ini **tidak berubah** — aman dibagikan berkali-kali. (Wallet tetap
melacak saldo di seluruh pool alamat turunan secara internal; layar Receive
sengaja hanya menampilkan alamat utama, tidak membuat alamat acak baru.)

### 4. Mengirim PRL — dengan / tanpa tip

1. Dashboard → **Send PRL**.
2. Isi **alamat tujuan** (`prl1p...`) dan **jumlah** PRL, pilih **fee tier**
   (low/normal/high), lalu **Review**.
3. Di layar konfirmasi muncul rincian: **Amount**, **Fee**, **Dev tip**,
   **Change** (kembalian), dan **Total leaving wallet**.
4. **Tip developer:** checkbox **"Send 0.5 PRL tip to support the dev"**
   **dicentang secara default**.
   - **Biarkan tercentang** → tip 0.5 PRL ikut sebagai output tambahan **dalam
     transaksi yang sama** (hemat — hanya satu fee). Alamat tip ditampilkan
     transparan: `prl1pl3ekgkcty7qy8rktk64km4zl6zrxu0ncc43mvh82kca2zdve2p0q3jv9fy`.
   - **Hilangkan centang** → **tidak ada** output tip sama sekali; Anda hanya
     bayar fee jaringan.
5. Wallet memvalidasi **jumlah + tip + fee ≤ saldo**. Jika kurang, muncul pesan
   jelas berapa yang dibutuhkan vs ditemukan — pengiriman diblokir.
6. Ketuk **Send**. Setelah broadcast, muncul **txid** + tautan explorer.

### 5. Multi-send

Kirim ke banyak penerima sekaligus dalam **satu transaksi** (hemat fee, dan
secara teknis aman karena UTXO yang sama tidak mungkin dipakai dua kali).

1. Dashboard → **Send to many**.
2. Isi tiap baris **Recipient**: alamat + jumlah. Ketuk **+ Add recipient**
   untuk menambah, atau **Remove** untuk menghapus baris.
3. Pilih fee tier, dan (opsional) centang tip developer.
4. **Review batch** → muncul ringkasan: daftar penerima, **Recipients total**,
   **Fee**, **Dev tip**, **Change**, dan **Total leaving wallet**.
5. Ketuk **Send to N** untuk broadcast.

### 6. Merge (kumpulkan semua PRL ke 1 wallet)

Mengumpulkan **seluruh saldo PRL** Anda (semua koin yang tersebar di banyak
UTXO) lalu **menyapunya (sweep) ke satu wallet tujuan**.

1. Dashboard → **Merge PRL to 1 wallet**.
2. Pilih **tujuan merge**:
   - **My primary address (this account)** — kembali ke alamat utama Anda
     (sekaligus konsolidasi koin agar pengiriman berikutnya murah & cepat), atau
   - **Another of my accounts** — pilih akun lain milik Anda (muncul jika punya
     >1 akun), atau
   - **Another wallet address** — tempel alamat `prl1p...` wallet mana saja.
3. Pilih fee tier, lalu **Review merge**.
4. Ringkasan menampilkan: jumlah UTXO, total saldo, fee, **Dev tip (mandatory)
   0.1 PRL**, **Destination wallet**, dan jumlah final **Sent to 1 wallet**.
5. Ketuk **Merge & send** untuk broadcast.

> 💡 **Tip wajib 0.1 PRL.** Berbeda dengan tip pada Send (yang opsional), operasi
> **Merge selalu** menyertakan tip developer **0.1 PRL per merge** dan **tidak
> bisa dimatikan**. Pengiriman biasa tetap gratis di luar fee jaringan.

### 7. Multi-akun

1. Dashboard → ketuk **chip akun** di atas (atau tombol **Accounts**).
2. Daftar semua akun muncul; akun aktif ditandai **Active**.
3. **Ganti akun:** ketuk **Switch** pada akun lain.
4. **Impor akun baru:** **+ Import another account** → beri nama (opsional) →
   tempel **seed phrase** (12/24 kata) → **Import account**.
5. **Hapus akun:** tombol **Remove** (hanya untuk akun non-aktif; akun terakhir
   tidak bisa dihapus).

> ⚠️ **Peringatan multi-perangkat:** hindari menandatangani transaksi dengan
> seed phrase yang **sama** di dua perangkat **secara bersamaan**. Karena Pearl L1
> memakai tanda tangan Taproot yang stateless, ini **bukan** risiko kebocoran
> kunci — tetapi tiap perangkat melacak UTXO-nya sendiri, sehingga menjalankan
> seed yang sama secara paralel bisa membuat satu perangkat mencoba membelanjakan
> koin yang sudah dipindahkan perangkat lain (transaksi gagal/tertolak).

### 8. Pengaturan tip

**Settings → Support the dev (tip):**
- **Aktif/nonaktif** tip secara global (default: aktif).
- **Tip amount (PRL):** ubah nominal tip (default **0.5 PRL**).
- Alamat penerima tip ditampilkan transparan.

Mau pakai gratis? Matikan tip di sini, atau cukup hilangkan centang di tiap
pengiriman. Wallet ini gratis di luar fee jaringan.

---

## Soal keamanan (penting)

- **Bukan XMSS.** Brief awal menyebut Pearl L1 memakai XMSS (tanda tangan
  post-quantum yang *stateful*). Pada kode sebenarnya, Pearl L1 di repo upstream
  memakai **Taproot + Schnorr secp256k1 (stateless, berbasis UTXO)**. Maka:
  - Tip & multi-send dikirim sebagai **output biasa** — **tidak ada** "one-time
    key" yang perlu dimajukan, **tidak ada** risiko reuse-indeks.
  - Yang tetap relevan: **pemilihan UTXO**. Karena itu multi-send memakai
    **satu transaksi multi-output** (bukan banyak transaksi terpisah), sehingga
    UTXO yang sama tidak mungkin dibelanjakan ganda dalam satu batch.
- **Seed tidak pernah keluar perangkat.** Tidak ada seed/kunci yang di-hardcode
  atau dikirim ke server. Seed disimpan **terenkripsi** (PBKDF2 + AES-256-GCM).
- **Fitur upstream dipertahankan:** auto-lock saat idle, ekspor seed auto-hide,
  CSP + allowlist RPC.
- **Tahan crash:** semua panggilan RPC/signing dibungkus try/catch dengan pesan
  yang bisa dibaca pengguna; kegagalan jaringan tidak membuat aplikasi crash.
- **APK debug-signed:** untuk sideload/uji. Untuk distribusi publik sebaiknya
  ditandatangani dengan keystore rilis Anda sendiri.

---

## Build dari source

Prasyarat: Node 20+, JDK 17/21, Android SDK (platform 34, build-tools 34).

```bash
npm install

# Jalankan tes upstream (termasuk vektor derivasi BIP-39)
npm test

# Build web/PWA
npm run build            # hasil di dist/

# Pratinjau web
npm run preview          # http://localhost:4173

# Screenshot walkthrough (Playwright)
npx playwright test      # hasil di screenshots/

# Build APK Android (debug)
npx cap sync android
cd android && ./gradlew assembleDebug
#   APK: android/app/build/outputs/apk/debug/app-debug.apk
```

APK siap-pakai sudah disertakan di **`dist/mobile-pearl-wallet.apk`**.

---

## Apa yang dipakai-ulang vs ditambahkan

**Dipakai ulang (verbatim, tidak diubah):**
- `src/crypto/*` — WebWorker, derivasi HD (BIP-39/BIP-32/BIP-86), mnemonic,
  keystore (PBKDF2 + AES-GCM).
- `src/chains/pearl/address.ts` — codec alamat Taproot bech32m + tweak BIP-86.
- Penandatanganan transaksi Pearl (`signPearlTx` via `@scure/btc-signer`).
- CSP, allowlist RPC, auto-lock, multi-tab keystore sync.

**Ditambahkan / diubah (UI + fitur):**
- Rebrand "Mobile Pearl Wallet" + logo/ikon baru.
- `Receive` dikunci ke satu alamat utama.
- Tip developer: nominal **flat** yang bisa diatur (default 0.5 PRL), alamat tip
  baru, checkbox per-transaksi (dicentang default) → output gabungan satu tx.
- Multi-akun: tabel keystore multi-record + pointer akun aktif (`src/storage/db.ts`,
  `src/state/wallet-store.ts`, halaman `Accounts`).
- Multi-send: `composePearlMultiSend` (satu tx multi-output) + halaman `MultiSend`.
- Merge: `composePearlMerge` (sapu seluruh saldo → 1 wallet tujuan; pilih alamat
  sendiri, akun lain, atau alamat eksternal) dengan tip **wajib 0.1 PRL**
  (`MERGE_TIP_GRAINS`) + halaman `Merge`.
- Capacitor (Android) + skrip ikon + walkthrough Playwright.

Lihat **laporan akhir** (final report) di chat untuk hasil tes derivasi dan
catatan lengkap.
