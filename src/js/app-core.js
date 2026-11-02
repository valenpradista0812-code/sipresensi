/**
 * SiPresensi - App Core Client Library
 * Handles authentication status, user profile syncing, logout, and shared toast notifications.
 */

window.SiPresensi = (function () {
  let currentUser = null;

  // Show Toast Notification
  function showToast(message, type = 'success') {
    let container = document.getElementById('sipresensi-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'sipresensi-toast-container';
      container.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 380px;
      `;
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const bgColor = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6';
    toast.style.cssText = `
      background: ${bgColor};
      color: #ffffff;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 14px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      justify-content: space-between;
      animation: fadeInToast 0.3s ease;
    `;
    toast.innerHTML = `
      <span>${message}</span>
      <button style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;margin-left:12px;">&times;</button>
    `;

    toast.querySelector('button').onclick = () => toast.remove();
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Fetch current logged in user and update header
  async function syncCurrentUser() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.status === 401) {
        // Not logged in and not on login page
        if (!window.location.pathname.includes('login.html')) {
          window.location.href = '/login.html';
        }
        return;
      }
      const data = await res.json();
      if (data.success && data.user) {
        currentUser = data.user;
        if (currentUser.nis) {
          localStorage.setItem('sipresensi_last_nis', currentUser.nis);
        }
        updateUserUI(currentUser);
      }
    } catch (err) {
      console.warn('Could not sync user info:', err);
    }
  }

  // Update Topbar and User Elements
  function updateUserUI(user) {
    // User name
    document.querySelectorAll('.user-name').forEach(el => {
      el.textContent = user.name;
    });

    // User role / title
    document.querySelectorAll('.user-role').forEach(el => {
      el.textContent = user.title || (user.role === 'guru' ? 'Guru / Pengajar' : 'Siswa • ' + (user.kelas || ''));
    });

    // Welcome banner name
    document.querySelectorAll('.welcome h2').forEach(el => {
      if (user.role === 'guru') {
        el.textContent = `Selamat Pagi, ${user.name.split(',')[0]}!`;
      } else {
        el.textContent = `Selamat Pagi, ${user.name}!`;
      }
    });

    // Avatar initial if exists
    document.querySelectorAll('.avatar-initial').forEach(el => {
      el.textContent = user.avatar || user.name.split(' ').map(n => n[0]).join('').slice(0, 2);
    });

    // Setup User Dropdown with Logout
    setupUserDropdown(user);

    // Add Logout to Sidebar
    setupSidebarLogout();
  }

  function setupUserDropdown(user) {
    const userContainer = document.querySelector('.topbar-right .user');
    if (!userContainer) return;

    userContainer.style.cursor = 'pointer';
    userContainer.style.position = 'relative';
    userContainer.setAttribute('title', 'Klik untuk menu profil / keluar');

    // Create dropdown menu if not exists
    let menu = document.getElementById('user-profile-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'user-profile-menu';
      menu.style.cssText = `
        display: none;
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 10px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        min-width: 200px;
        z-index: 1000;
        padding: 6px 0;
      `;
      menu.innerHTML = `
        <div style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9;">
          <div style="font-weight: 600; font-size: 13px; color: #1e293b;">${user.name}</div>
          <div style="font-size: 12px; color: #64748b;">${user.email}</div>
          <div style="font-size: 11px; color: #10b981; font-weight: 600; margin-top: 2px;">Peran: ${user.role.toUpperCase()}</div>
        </div>
        ${user.role === 'guru' ? '<a href="/dashboard-siswa.html" style="display:block; padding: 8px 14px; font-size: 13px; color:#475569; text-decoration:none;">Lihat Tampilan Siswa &rarr;</a>' : '<a href="/detail-absensi.html" style="display:block; padding: 8px 14px; font-size: 13px; color:#475569; text-decoration:none;">Detail Absensi Saya</a>'}
        <button id="btn-open-change-pw" style="width: 100%; text-align: left; padding: 8px 14px; font-size: 13px; color: #334155; background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 8px;">
          <svg style="width:14px;height:14px;color:#2563eb;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Ganti Kata Sandi
        </button>
        <div style="border-top: 1px solid #f1f5f9; margin-top: 4px;"></div>
        <button id="btn-do-logout" style="width: 100%; text-align: left; padding: 8px 14px; font-size: 13px; color: #ef4444; background: none; border: none; cursor: pointer; display: flex; align-items: center; gap: 8px;">
          <svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Keluar (Logout)
        </button>
      `;

      userContainer.appendChild(menu);

      userContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      });

      document.addEventListener('click', () => {
        menu.style.display = 'none';
      });

      const btnChangePw = menu.querySelector('#btn-open-change-pw');
      if (btnChangePw) {
        btnChangePw.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.style.display = 'none';
          openChangePasswordModal();
        });
      }

      const btnLogout = menu.querySelector('#btn-do-logout');
      if (btnLogout) {
        btnLogout.addEventListener('click', logout);
      }
    }
  }

  // Modal Ganti Kata Sandi Global
  function openChangePasswordModal() {
    let modal = document.getElementById('sipresensi-change-pw-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sipresensi-change-pw-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(15, 23, 42, 0.65);
        backdrop-filter: blur(4px);
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        box-sizing: border-box;
      `;
      modal.innerHTML = `
        <div style="background:#ffffff; width:100%; max-width:420px; border-radius:12px; padding:24px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); border:1px solid #e2e8f0; font-family:'Plus Jakarta Sans',sans-serif;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <h3 style="margin:0; font-size:18px; font-weight:700; color:#1e293b; display:flex; align-items:center; gap:8px;">
              <svg style="width:20px;height:20px;color:#2563eb;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Ganti Kata Sandi
            </h3>
            <button type="button" id="cpw-btn-close" style="background:none; border:none; font-size:24px; cursor:pointer; color:#94a3b8; line-height:1;">&times;</button>
          </div>
          <p style="font-size:13px; color:#64748b; margin:0 0 16px 0;">Perbarui kata sandi akun Anda untuk keamanan sistem.</p>
          <form id="cpw-form">
            <div style="margin-bottom:12px;">
              <label style="display:block; font-size:13px; font-weight:600; color:#334155; margin-bottom:4px;">Kata Sandi Lama Saat Ini</label>
              <input type="password" id="cpw-old" required placeholder="Masukkan kata sandi lama..." style="width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
              <label style="display:block; font-size:13px; font-weight:600; color:#334155; margin-bottom:4px;">Kata Sandi Baru</label>
              <input type="password" id="cpw-new" required minlength="5" placeholder="Minimal 5 karakter..." style="width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;">
            </div>
            <div style="margin-bottom:20px;">
              <label style="display:block; font-size:13px; font-weight:600; color:#334155; margin-bottom:4px;">Konfirmasi Kata Sandi Baru</label>
              <input type="password" id="cpw-confirm" required minlength="5" placeholder="Ulangi kata sandi baru..." style="width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;">
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
              <button type="button" id="cpw-btn-cancel" style="padding:9px 18px; border:1px solid #cbd5e1; background:#f8fafc; color:#475569; font-weight:600; border-radius:8px; cursor:pointer; font-size:14px;">Batal</button>
              <button type="submit" id="cpw-btn-submit" style="padding:9px 20px; border:none; background:#2563eb; color:#ffffff; font-weight:600; border-radius:8px; cursor:pointer; font-size:14px;">Simpan Sandi</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);

      const close = () => {
        modal.style.display = 'none';
        document.getElementById('cpw-form').reset();
      };

      modal.querySelector('#cpw-btn-close').onclick = close;
      modal.querySelector('#cpw-btn-cancel').onclick = close;

      modal.querySelector('#cpw-form').onsubmit = async (e) => {
        e.preventDefault();
        const oldPassword = document.getElementById('cpw-old').value;
        const newPassword = document.getElementById('cpw-new').value;
        const confirmPassword = document.getElementById('cpw-confirm').value;

        if (newPassword !== confirmPassword) {
          showToast('Konfirmasi kata sandi baru tidak cocok!', 'error');
          return;
        }

        const btnSubmit = document.getElementById('cpw-btn-submit');
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Menyimpan...';

        try {
          const res = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPassword, newPassword, confirmPassword })
          });
          const json = await res.json();
          if (json.success) {
            showToast(json.message || 'Kata sandi berhasil diperbarui!', 'success');
            close();
          } else {
            showToast(json.message || 'Gagal mengubah kata sandi.', 'error');
          }
        } catch (err) {
          showToast('Gagal terhubung ke server.', 'error');
        } finally {
          btnSubmit.disabled = false;
          btnSubmit.textContent = 'Simpan Sandi';
        }
      };
    }
    modal.style.display = 'flex';
  }

  function setupSidebarLogout() {
    const nav = document.querySelector('.sidebar .nav');
    if (!nav || document.getElementById('sidebar-logout-link')) return;

    const logoutLink = document.createElement('a');
    logoutLink.id = 'sidebar-logout-link';
    logoutLink.href = '#';
    logoutLink.style.marginTop = 'auto';
    logoutLink.style.color = '#ef4444';
    logoutLink.innerHTML = `
      <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      <span>Keluar</span>
    `;

    logoutLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('Apakah Anda yakin ingin keluar dari SiPresensi?')) {
        logout();
      }
    });

    nav.appendChild(logoutLink);
  }

  // Logout action
  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    window.location.href = '/login.html';
  }

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', () => {
    syncCurrentUser();
  });

  return {
    getUser: () => currentUser,
    logout,
    showToast,
    syncCurrentUser
  };
})();
