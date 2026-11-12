-- PETUGAS ROLE
-- Lakukan dua langkah di Supabase SQL Editor:
--
-- Langkah 1: jalankan baris ALTER di bawah (ctr+A seluruh file, lalu Run).
--   Setelah berhasil, akan muncul pesan "Success".
--
-- Langkah 2: hapus komentar `--` pada blok INSERT (Bagian 2), lalu Run KEMBALI
--   secara terpisah. INSERT tidak boleh berjalan pada transaksi yang sama
--   dengan ALTER TYPE ADD VALUE.

-- ============================================================
-- Bagian 1: tambahkan role 'petugas' ke enum role_user
-- ============================================================
ALTER TYPE role_user ADD VALUE IF NOT EXISTS 'petugas';

-- ============================================================
-- Bagian 2: buat akun petugas awal (password default: petugas123)
-- Jalankan SETELAH Bagian 1 sukses, sebagai query terpisah.
-- ============================================================
-- INSERT INTO public.users (id, email, password, name, role, title, nip, nis, kelas, phone, avatar)
-- SELECT 'usr-petugas', 'petugas@sman1jkt.sch.id',
--        '$2a$10$Vq5Val9ayIDct1q3TEwVN.09Czxr/fSfQZ8mGGxABHq/8JnRP4T2K',
--        'Petugas SiPresensi', 'petugas', 'Petugas', NULL, NULL, NULL, '-', 'PS'
-- WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'petugas@sman1jkt.sch.id');