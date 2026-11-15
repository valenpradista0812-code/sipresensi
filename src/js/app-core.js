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

  // Reusable confirmation dialog
  const confirmIcons = {
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  let confirmElements = null;
  let confirmResolver = null;
  let confirmLastFocus = null;

  function ensureConfirmDialog() {
    if (confirmElements) return confirmElements;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.id = 'sipresensi-confirm-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sipresensi-confirm-title" aria-describedby="sipresensi-confirm-desc" data-variant="danger">
        <div class="confirm-icon" aria-hidden="true"></div>
        <h2 class="confirm-title" id="sipresensi-confirm-title">Konfirmasi</h2>
        <p class="confirm-desc" id="sipresensi-confirm-desc"></p>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn--cancel" type="button">Batal</button>
          <button class="confirm-btn confirm-btn--confirm" type="button">Ya, Lanjutkan</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const dialog = overlay.querySelector('.confirm-dialog');
    const title = overlay.querySelector('.confirm-title');
    const desc = overlay.querySelector('.confirm-desc');
    const icon = overlay.querySelector('.confirm-icon');
    const cancel = overlay.querySelector('.confirm-btn--cancel');
    const confirm = overlay.querySelector('.confirm-btn--confirm');

    function settle(value) {
      if (!overlay.classList.contains('show')) return;
      overlay.classList.remove('show');
      overlay.setAttribute('aria-hidden', 'true');
      const resolver = confirmResolver;
      confirmResolver = null;
      if (confirmLastFocus && typeof confirmLastFocus.focus === 'function') {
        confirmLastFocus.focus({ preventScroll: true });
      }
      if (resolver) resolver(value);
    }

    cancel.addEventListener('click', () => settle(false));
    confirm.addEventListener('click', () => settle(true));
    overlay.addEventListener('click', event => {
      if (event.target === overlay) settle(false);
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === cancel ? confirm : cancel).focus();
      }
    });

    confirmElements = { overlay, dialog, title, desc, icon, cancel, confirm };
    return confirmElements;
  }

  function showConfirm(options = {}) {
    const {
      title = 'Konfirmasi',
      message = '',
      confirmText = 'Ya, Lanjutkan',
      cancelText = 'Batal',
      variant = 'danger',
      icon = ''
    } = options;
    const elements = ensureConfirmDialog();

    // Tutup dialog sebelumnya (jika ada) agar tidak menumpuk.
    if (confirmResolver) {
      const previous = confirmResolver;
      confirmResolver = null;
      previous(false);
      elements.overlay.classList.remove('show');
      elements.overlay.setAttribute('aria-hidden', 'true');
    }

    const iconName = icon || (variant === 'warning' ? 'warning' : variant === 'success' ? 'save' : 'trash');
    elements.dialog.dataset.variant = variant;
    elements.icon.innerHTML = confirmIcons[iconName] || confirmIcons.info;
    elements.title.textContent = title;
    elements.desc.textContent = message;
    elements.cancel.textContent = cancelText;
    elements.confirm.textContent = confirmText;

    confirmLastFocus = document.activeElement;
    elements.overlay.classList.add('show');
    elements.overlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      if (elements.overlay.classList.contains('show')) {
        elements.cancel.focus({ preventScroll: true });
      }
    });

    return new Promise(resolve => {
      confirmResolver = resolve;
    });
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

  // Update User UI elements on pages
  function updateUserUI(user) {
    const nameEls = document.querySelectorAll('.user-name');
    nameEls.forEach(el => {
      if (el && user.name && el.textContent.trim() === '-') {
        el.textContent = user.name;
      }
    });

    const roleEls = document.querySelectorAll('.user-role');
    roleEls.forEach(el => {
      if (el && user.role && el.textContent.trim() === '-') {
        el.textContent = user.role === 'admin' ? 'Admin Kepegawaian' : (user.role === 'guru' ? 'Guru / Pengajar' : (user.role === 'petugas' ? 'Petugas' : 'Siswa'));
      }
    });

    // Add sidebar logout link if sidebar exists
    const nav = document.querySelector('.sidebar-nav, .glass-nav');
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
      if (window._openLogoutConfirm) {
        window._openLogoutConfirm(() => {
          logout();
        }, logoutLink);
      } else {
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

  // Initialize Liquid Glass Logout Modal on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    syncCurrentUser();

    if (!document.getElementById('lg-overlay')) {
      const modalHTML = `
        <!-- Popup konfirmasi logout (Liquid Glass) -->
        <div class="lg-overlay" id="lg-overlay" aria-hidden="true">
          <div class="lg-dialog" role="alertdialog" aria-modal="true" aria-labelledby="lg-title" aria-describedby="lg-desc">
            <div class="lg-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <path d="M16 17l5-5-5-5"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </div>
            <h2 class="lg-title" id="lg-title">Keluar dari akun?</h2>
            <p class="lg-desc" id="lg-desc">Kamu harus login kembali untuk mengakses sistem SiPresensi.</p>
            <div class="lg-actions">
              <button class="lg-btn lg-btn--cancel" id="lg-cancel" type="button">Batal</button>
              <button class="lg-btn lg-btn--confirm" id="lg-confirm" type="button">Keluar</button>
            </div>
          </div>
        </div>
        <style>
          .lg-overlay {
            position: fixed; inset: 0; z-index: 99999; display: grid; place-items: center; padding: 20px;
            background: rgba(15,23,42,.14); -webkit-backdrop-filter: blur(8px) saturate(140%); backdrop-filter: blur(8px) saturate(140%);
            opacity: 0; visibility: hidden; transition: opacity .3s ease, visibility 0s linear .3s;
          }
          .lg-overlay.show { opacity: 1; visibility: visible; transition: opacity .3s ease, visibility 0s; }
          .lg-dialog {
            position: relative; width: min(380px, 100%); padding: 28px 24px 24px; border-radius: 28px; text-align: center;
            background: linear-gradient(180deg, rgba(255,255,255,.72), rgba(255,255,255,.46)); border: 1px solid rgba(255,255,255,.8);
            -webkit-backdrop-filter: blur(20px) saturate(160%); backdrop-filter: blur(20px) saturate(160%);
            box-shadow: inset 0 0 0 1px rgba(255,255,255,.12), inset 1.8px 3px 0 -2px rgba(255,255,255,.9), inset -2px -2px 0 -2px rgba(255,255,255,.8), inset -3px -8px 1px -6px rgba(255,255,255,.6), inset -0.3px -1px 4px 0 rgba(0,0,0,.12), inset -1.5px 2.5px 0 -2px rgba(0,0,0,.2), inset 0 3px 4px -2px rgba(0,0,0,.2), 0 1px 5px rgba(0,0,0,.1), 0 20px 50px rgba(15,23,42,.18);
            transform: translateY(18px) scale(.92); opacity: 0; transition: transform .45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity .25s ease; overflow: hidden;
          }
          .lg-dialog::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(160deg, rgba(255,255,255,.6) 0%, rgba(255,255,255,0) 40%); pointer-events: none; }
          .lg-overlay.show .lg-dialog { transform: none; opacity: 1; transition: transform .55s cubic-bezier(0.34, 1.56, 0.64, 1) .04s, opacity .3s ease .04s; }
          .lg-icon {
            position: relative; z-index: 1; width: 64px; height: 64px; margin: 0 auto 18px; border-radius: 50%; display: grid; place-items: center;
            background: rgba(239,68,68,.12); box-shadow: inset 0 1px 0 rgba(255,255,255,.8), 0 6px 16px rgba(239,68,68,.15); color: #ef4444;
          }
          .lg-icon svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
          .lg-title { position: relative; z-index: 1; margin: 0 0 8px; font-size: 20px; font-weight: 800; color: #1e293b; }
          .lg-desc { position: relative; z-index: 1; margin: 0 0 24px; font-size: 14px; line-height: 1.55; color: #64748b; }
          .lg-actions { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
          .lg-btn { height: 50px; border: none; border-radius: 999px; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; transition: transform .3s cubic-bezier(0.34, 1.56, 0.64, 1), background-color .2s ease, box-shadow .2s ease; }
          .lg-btn:hover { transform: translateY(-1px); }
          .lg-btn:active { transform: scale(.96); }
          .lg-btn:focus-visible { outline: 2px solid #0052f5; outline-offset: 3px; }
          .lg-btn--cancel { color: #1e293b; background: rgba(255,255,255,.6); border: 1px solid rgba(255,255,255,.9); box-shadow: inset 0 1px 0 rgba(255,255,255,.8), 0 4px 10px rgba(15,23,42,.06); }
          .lg-btn--cancel:hover { background: rgba(255,255,255,.85); }
          .lg-btn--confirm { color: #fff; background: linear-gradient(180deg, #f87171, #ef4444); box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 8px 18px rgba(239,68,68,.3); }
          .lg-btn--confirm:hover { box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 10px 22px rgba(239,68,68,.36); }
        </style>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHTML);

      const overlay = document.getElementById('lg-overlay');
      const cancelBtn = document.getElementById('lg-cancel');
      const confirmBtn = document.getElementById('lg-confirm');
      let lastFocus = null;
      let confirmAction = null;

      window._openLogoutConfirm = function(onConfirm, trigger) {
        lastFocus = trigger || document.activeElement;
        confirmAction = onConfirm;
        if (overlay) {
          overlay.classList.add('show');
          overlay.setAttribute('aria-hidden', 'false');
          requestAnimationFrame(() => cancelBtn && cancelBtn.focus({ preventScroll: true }));
        }
      };

      function closeLogoutConfirm() {
        if (!overlay || !overlay.classList.contains('show')) return;
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
      }

      if (cancelBtn) cancelBtn.addEventListener('click', closeLogoutConfirm);
      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
          const action = confirmAction;
          closeLogoutConfirm();
          if (typeof action === 'function') action();
        });
      }
      if (overlay) {
        overlay.addEventListener('click', e => {
          if (e.target === overlay) closeLogoutConfirm();
        });
      }

      document.addEventListener('keydown', e => {
        if (!overlay || !overlay.classList.contains('show')) return;
        if (e.key === 'Escape') {
          closeLogoutConfirm();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          if (cancelBtn && confirmBtn) {
            (document.activeElement === cancelBtn ? confirmBtn : cancelBtn).focus();
          }
        }
      });
    }

    // Global capture-phase click delegation for logout buttons
    document.addEventListener('click', function(e) {
      // Biarkan tombol di dalam modal logout menangani kliknya sendiri.
      if (e.target.closest('#lg-overlay')) return;

      const logoutBtn = e.target.closest('.btn-logout, [aria-label="Logout"], [aria-label="Keluar"], [title="Logout"], [title="Keluar"], #sidebar-logout-link');
      if (logoutBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (window._openLogoutConfirm) {
          window._openLogoutConfirm(() => {
            logout();
          }, logoutBtn);
        } else {
          logout();
        }
        return;
      }

      const el = e.target.closest('.menu-item, button, a');
      if (el) {
        const text = el.textContent.trim().toLowerCase();
        if (text === 'keluar' || text === 'logout') {
          e.preventDefault();
          e.stopPropagation();
          if (window._openLogoutConfirm) {
            window._openLogoutConfirm(() => {
              logout();
            }, el);
          } else {
            logout();
          }
        }
      }
    }, true);
  });

  return {
    getUser: () => currentUser,
    logout,
    showToast,
    confirm: showConfirm,
    syncCurrentUser
  };
})();
