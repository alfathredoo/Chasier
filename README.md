# Ruang Kasir

Aplikasi kasir lokal berbasis Node.js dan SQLite untuk mengelola katalog, pelanggan, transaksi, stok, dan pengaturan outlet.

## Menjalankan

1. Pastikan Node.js versi 22.13 atau lebih baru sudah terpasang.
2. Buka terminal pada folder `WebChasier`.
3. Jalankan `npm start`.
4. Buka `http://127.0.0.1:3000` di browser.

SQLite tersedia melalui modul bawaan Node.js. Tidak perlu menginstal package tambahan atau menyiapkan MySQL. File database dibuat otomatis pada `data/ruang-kasir.sqlite` saat server pertama kali dijalankan. Server hanya menerima koneksi lokal dari komputer yang sama.

## Fitur

- Cari dan filter menu berdasarkan kategori.
- Urutkan katalog berdasarkan popularitas atau harga.
- Tambah, edit, arsipkan, pulihkan produk, serta kelola harga dan stok.
- Tambah, edit, cari, dan hapus data pelanggan.
- Tambah, kurangi, dan hapus item dari pesanan.
- Pilih tipe pesanan dine-in atau take-away.
- Hitung pajak 10% secara otomatis.
- Catat transaksi tunai, QRIS, atau kartu debit ke database SQLite.
- Tambahkan nama dan nomor telepon pelanggan ke pesanan.
- Cari riwayat pembelian berdasarkan pelanggan, produk, atau nomor transaksi.
- Tampilkan QRIS merchant pada pembayaran dengan mengunggah gambar PNG, JPG, atau WebP.
- Validasi uang tunai dan hitung kembalian.
- Simpan transaksi dan detail produknya secara permanen di database SQLite.
- Cetak struk pelanggan berisi pembayaran dan slip dapur tanpa harga, termasuk cetak ulang dari riwayat.
- Kelola nama dan nomor HP kasir, mulai/pergantian/akhiri shift, serta lihat riwayat shift.
- Simpan identitas kasir dan shift sebagai snapshot pada transaksi, struk, dan riwayat.
- Lihat ringkasan usaha, tren penjualan, pelanggan, dan riwayat transaksi.
- Atur identitas usaha, outlet, tarif pajak, dan QRIS dari menu pengaturan.
- Tampilan responsif untuk layar desktop dan ponsel.

## Kustomisasi

Katalog awal delapan produk dimasukkan otomatis ke database saat pertama kali dijalankan. Produk berikutnya dikelola melalui halaman Produk. Tarif pajak awal 10% dan dapat diubah di Pengaturan. Riwayat transaksi, stok, pelanggan, dan pengaturan disimpan dalam database SQLite lokal, tidak lagi di `localStorage`.

Unggah gambar QRIS statis resmi milik merchant melalui Pengaturan. QRIS ini tidak menghasilkan nominal dinamis dan tidak tersambung ke penyedia pembayaran; pastikan transaksi sudah masuk ke akun merchant sebelum mengonfirmasi pembayaran di kasir.

Sesudah pembayaran berhasil, gunakan tombol **Cetak struk** atau **Cetak dapur**. Riwayat transaksi menyediakan tombol untuk mencetak ulang kedua dokumen. Layout menggunakan ukuran kertas thermal 80 mm; pilih printer thermal atau ubah ukuran kertas/scale dari dialog cetak browser jika printer memakai ukuran lain.

## Kasir dan pergantian shift

Klik profil kasir pada sidebar untuk memperbarui nama dan nomor HP, memulai shift, mengganti kasir/shift, atau mengakhiri shift. Nomor HP wajib diisi dengan 8–15 digit. Pergantian akan menutup shift sebelumnya dan langsung membuka shift berikutnya; setiap transaksi menyimpan nama, nomor HP, dan shift yang bertugas saat transaksi dibuat. Setelah shift diakhiri, kasir perlu memulai shift baru sebelum pembayaran dapat diproses.

Saat instalasi baru, aplikasi membuka shift awal bernama **Shift pagi** dengan nama contoh “Nadia Putri”. Lengkapi identitas serta nomor HP melalui profil sebelum menerima pembayaran. Data transaksi lama tetap tersimpan; transaksi sebelum fitur shift akan ditampilkan sebagai transaksi kasir lama.

## Data dan cadangan

Hentikan server sebelum menyalin `data/ruang-kasir.sqlite` untuk membuat cadangan. File database dikecualikan dari Git agar data penjualan dan QRIS tidak ikut masuk ke repositori. Jangan letakkan database tersebut pada folder publik.

## Batas penggunaan

Aplikasi ini untuk satu komputer dan satu server lokal. Belum tersedia autentikasi, hak akses kasir, sinkronisasi antarkomputer, pembayaran QRIS otomatis, atau layanan cloud. Jangan mengekspos server ke jaringan publik tanpa menambahkan autentikasi dan pengamanan yang sesuai.
