(function() {
  function wait(milliseconds, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Pemindaian dibatalkan.', 'AbortError'));
        return;
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, milliseconds);
      function abort() {
        clearTimeout(timer);
        reject(new DOMException('Pemindaian dibatalkan.', 'AbortError'));
      }
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  async function scanRfidCard({ onStatus = () => {}, signal } = {}) {
    onStatus('Menunggu Pemindaian. Tempelkan kartu pada alat RFID dalam 30 detik.');
    const startResponse = await fetch('/api/iot/scan/start', { method: 'POST', signal });
    const startResult = await startResponse.json();
    if (!startResponse.ok || !startResult.success) {
      throw new Error(startResult.message || 'Gagal memulai pemindaian RFID.');
    }

    const deadline = Date.now() + 31000;
    while (Date.now() < deadline) {
      await wait(700, signal);
      const statusResponse = await fetch('/api/iot/scan/status', { signal });
      const statusResult = await statusResponse.json();
      if (!statusResponse.ok || !statusResult.success) {
        throw new Error(statusResult.message || 'Gagal membaca status pemindaian RFID.');
      }
      if (statusResult.status === 'complete' && statusResult.uid) return statusResult.uid;
      if (statusResult.status === 'timeout') {
        throw new Error(statusResult.message || 'Waktu pemindaian habis. Silakan coba lagi.');
      }
    }

    throw new Error('Waktu pemindaian habis. Pastikan ESP32 terhubung ke server.');
  }

  window.SiPresensi = window.SiPresensi || {};
  window.SiPresensi.scanRfidCard = scanRfidCard;
})();
