/**
 * SiPresensi - Student Greeting Component
 * Komponen greeting sederhana untuk halaman detail absensi siswa
 */

const StudentGreeting = {
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
   * Inisialisasi greeting section dengan data siswa
   * @param {Object} studentData - Data siswa dari server
   */
  init(studentData = {}) {
    const now = new Date();
    const studentName = studentData.name || 'Siswa';
    const greeting = this.getGreetingByTime(now);
    const dateFormatted = this.formatDateIndonesian(now);

    // Update greeting title (h2)
    const titleElement = document.getElementById('greeting-title');
    if (titleElement) {
      titleElement.textContent = `Selamat ${greeting}, ${studentName}!`;
    }

    // Update greeting subtitle (p)
    const subtitleElement = document.getElementById('greeting-subtitle');
    if (subtitleElement) {
      subtitleElement.textContent = `Hari ini: ${dateFormatted}. Sistem presensi geo-tagging mencatat kehadiranmu dengan akurat.`;
    }
  }
};

// Export untuk digunakan di browser
if (typeof window !== 'undefined') {
  window.StudentGreeting = StudentGreeting;
}
