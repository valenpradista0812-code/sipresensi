/**
 * SiPresensi - Greeting Component
 * Komponen greeting yang mengikuti waktu lokal secara realtime.
 * Dipakai halaman siswa, guru/admin, dan petugas.
 */

const SiGreeting = {
  _name: '',
  _fallbackName: 'Siswa',
  _subtitle: 'Sistem presensi geo-tagging mencatat kehadiranmu dengan akurat.',
  _cacheKey: 'student_name',
  _timerId: null,
  _syncStarted: false,
  _visibilityBound: false,

  /**
   * Format tanggal ke bahasa Indonesia
   * @param {Date} date - Objek date
   * @returns {string} - Tanggal terformat (contoh: "Senin, 7 November 2026")
   */
  formatDateIndonesian(date) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    const dayName = days[date.getDay()];
    const dayNum = date.getDate();
    const monthName = months[date.getMonth()];
    const year = date.getFullYear();

    return `${dayName}, ${dayNum} ${monthName} ${year}`;
  },

  /**
   * Dapatkan sapaan berdasarkan waktu (Selamat Pagi, Siang, Sore, Malam)
   * @param {Date} date - Objek date
   * @returns {string} - Sapaan (Pagi, Siang, Sore, atau Malam)
   */
  getGreetingByTime(date) {
    const hours = date.getHours();

    if (hours >= 5 && hours < 11) {
      return 'Pagi';
    } else if (hours >= 11 && hours < 15) {
      return 'Siang';
    } else if (hours >= 15 && hours < 19) {
      return 'Sore';
    } else {
      return 'Malam';
    }
  },

  /**
   * Ambil nama pengguna yang tersimpan di sesi tab ini.
   * @returns {string}
   */
  getCachedName() {
    if (!this._cacheKey) return '';
    try {
      return (sessionStorage.getItem(this._cacheKey) || '').trim();
    } catch (error) {
      return '';
    }
  },

  /**
   * Tampilkan greeting berdasarkan waktu saat ini.
   * Hanya memperbarui DOM jika teks benar-benar berubah.
   */
  render() {
    const now = new Date();
    const name = (this._name || '').trim() || this._fallbackName;
    const title = `Selamat ${this.getGreetingByTime(now)}, ${name}!`;
    const subtitle = `Hari ini: ${this.formatDateIndonesian(now)}. ${this._subtitle}`;

    const titleElement = document.getElementById('greeting-title');
    if (titleElement && titleElement.textContent !== title) {
      titleElement.textContent = title;
    }

    const subtitleElement = document.getElementById('greeting-subtitle');
    if (subtitleElement && subtitleElement.textContent !== subtitle) {
      subtitleElement.textContent = subtitle;
    }
  },

  /**
   * Sinkronkan nama pengguna dengan akun yang sedang login.
   * Dipakai ketika halaman tidak menyuplai nama secara eksplisit.
   */
  async syncNameFromServer() {
    if (this._syncStarted) return;
    this._syncStarted = true;

    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) return;

      const data = await response.json();
      const name = data && data.success && data.user ? String(data.user.name || '').trim() : '';
      if (!name) return;

      this._name = name;
      if (this._cacheKey) {
        try {
          sessionStorage.setItem(this._cacheKey, name);
        } catch (error) {
          // sessionStorage bisa tidak tersedia (mode privat); abaikan.
        }
      }
      this.render();
    } catch (error) {
      console.warn('Gagal menyinkronkan nama pengguna:', error);
    }
  },

  /**
   * Jalankan pembaruan greeting berkala agar tanggal dan sapaan
   * tetap mengikuti waktu berjalan (mis. pergantian Pagi -> Siang).
   */
  startRealtimeUpdate() {
    this.render();

    if (this._timerId === null) {
      this._timerId = window.setInterval(() => this.render(), 1000);
    }

    if (!this._visibilityBound) {
      this._visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.render();
      });
    }
  },

  /**
   * Inisialisasi greeting section.
   * @param {Object} options - Opsi greeting
   * @param {string} [options.name] - Nama pengguna dari server
   * @param {string} [options.fallbackName] - Nama cadangan sebelum data akun termuat
   * @param {string} [options.subtitle] - Kalimat pendamping setelah tanggal
   * @param {string|null} [options.cacheKey] - Kunci sessionStorage untuk cache nama
   */
  init(options = {}) {
    const providedName = options && typeof options.name === 'string'
      ? options.name.trim()
      : '';

    if (options && typeof options.fallbackName === 'string' && options.fallbackName.trim()) {
      this._fallbackName = options.fallbackName.trim();
    }
    if (options && typeof options.subtitle === 'string' && options.subtitle.trim()) {
      this._subtitle = options.subtitle.trim();
    }
    if (options && options.cacheKey !== undefined) {
      this._cacheKey = options.cacheKey;
    }

    this._name = providedName || this.getCachedName();
    this.startRealtimeUpdate();

    // Jika halaman tidak memberi nama, ambil nama akun dari server.
    if (!providedName) {
      this.syncNameFromServer();
    }
  }
};

// Export untuk digunakan di browser
if (typeof window !== 'undefined') {
  window.SiGreeting = SiGreeting;
  // Alias lama agar halaman siswa yang sudah ada tetap berjalan.
  window.StudentGreeting = SiGreeting;
}
