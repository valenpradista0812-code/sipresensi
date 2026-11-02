/**
 * SiPresensi - Shared Utilities Component
 * Utility functions yang digunakan bersama oleh admin dan siswa
 */

const SharedUtils = {
  // Format tanggal ke format Indonesia
  formatDate(date) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(date).toLocaleDateString('id-ID', options);
  },

  // Format waktu ke format Indonesia
  formatTime(date) {
    return new Date(date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  },

  // Tampilkan notifikasi toast
  showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container') || this.createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${message}</span>
      <button class="toast-close">&times;</button>
    `;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.remove();
    }, 3000);
  },

  // Buat container toast jika belum ada
  createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
  },

  // Loading state
  setLoading(element, isLoading) {
    if (isLoading) {
      element.disabled = true;
      element.dataset.originalText = element.innerHTML;
      element.innerHTML = '<span class="loading-spinner"></span> Memuat...';
    } else {
      element.disabled = false;
      element.innerHTML = element.dataset.originalText || '';
    }
  },

  // Parse query string
  parseQueryString(queryString) {
    const params = new URLSearchParams(queryString);
    const result = {};
    for (const [key, value] of params) {
      result[key] = value;
    }
    return result;
  },

  // Serialize form data
  serializeForm(form) {
    const formData = new FormData(form);
    const data = {};
    for (const [key, value] of formData) {
      data[key] = value;
    }
    return data;
  }
};

// Export untuk digunakan di browser
if (typeof window !== 'undefined') {
  window.SharedUtils = SharedUtils;
}