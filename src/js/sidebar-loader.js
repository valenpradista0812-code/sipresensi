/**
 * SiPresensi - Sidebar Loader
 * Memuat sidebar HTML dari file terpisah secara dinamis
 */

(function() {
  // Tunggu DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
  } else {
    initSidebar();
  }

  async function initSidebar() {
    const container = document.getElementById('sidebar-container');
    if (!container) return;

    // Tentukan role dari body class atau URL
    let role = 'admin';
    if (document.body.classList.contains('siswa')) {
      role = 'student';
    } else if (document.body.classList.contains('petugas')) {
      role = 'petugas';
    }

    // Load sidebar HTML
    try {
      const path = role === 'student' 
        ? '/public/components/student/sidebar-content.html' 
        : role === 'petugas'
          ? '/public/components/petugas/sidebar-content.html'
          : '/public/components/admin/sidebar-content.html';
      
      const response = await fetch(path);
      if (!response.ok) throw new Error('Failed to load sidebar');
      
      const html = await response.text();
      container.innerHTML = html;
      
      if (role === 'admin' || role === 'petugas') {
        setupAdminGlassSidebar(container);
      } else {
        setupSidebarLogic();
      }
    } catch (err) {
      console.error('Sidebar loader error:', err);
    }
  }

  function setupSidebarLogic() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const hamburger = document.getElementById('hamburger');
    const closeBtn = document.getElementById('sidebar-close');

    if (!sidebar) return;

    // Hamburger toggle untuk mobile
    if (hamburger) {
      hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.add('open');
        if (overlay) overlay.classList.add('show');
        document.body.classList.add('no-scroll');
      });
    }

    // Close button
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.classList.remove('no-scroll');
      });
    }

    // Overlay click
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
        document.body.classList.remove('no-scroll');
      });
    }

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.classList.remove('no-scroll');
      }
    });

    // Set active menu item berdasarkan URL
    const currentPath = window.location.pathname;
    const currentFile = currentPath.split('/').pop() || 'dashboard.html';

    sidebar.querySelectorAll('.nav a').forEach(link => {
      const href = link.getAttribute('href');
      const linkFile = href.split('/').pop();
      
      if (linkFile === currentFile) {
        link.classList.add('active');
      }
    });

    // Close sidebar saat link diklik (mobile)
    sidebar.querySelectorAll('.nav a').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 640) {
          sidebar.classList.remove('open');
          if (overlay) overlay.classList.remove('show');
          document.body.classList.remove('no-scroll');
        }
      });
    });

    // Close sidebar saat resize ke desktop
    window.addEventListener('resize', () => {
      if (window.innerWidth > 640) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.classList.remove('no-scroll');
      }
    });
  }

  function setupAdminGlassSidebar(container) {
    const nav = container.querySelector('.admin-glass-nav');
    const indicator = container.querySelector('.admin-glass-indicator');
    const navItems = nav ? Array.from(nav.querySelectorAll('.admin-glass-nav-item')) : [];
    const currentPage = container.dataset.currentPage || window.location.pathname.split('/').pop() || 'dashboard.html';
    const activeItem = navItems.find(item => item.dataset.page === currentPage);
    const mobileItems = Array.from(container.querySelectorAll('.admin-mobile-item[data-page]'));

    fetch('/api/auth/me')
      .then(response => response.json())
      .then(result => {
        const isAdmin = result.success && ['admin', 'guru'].includes(result.user?.role);
        container.querySelectorAll('[data-admin-only="true"]').forEach(item => {
          item.style.display = isAdmin ? '' : 'none';
        });
      })
      .catch(error => {
        console.error('Gagal memuat hak akses menu admin:', error);
        container.querySelectorAll('[data-admin-only="true"]').forEach(item => {
          item.style.display = 'none';
        });
      });

    navItems.forEach(item => {
      if (item === activeItem) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
    });
    mobileItems.forEach(item => {
      const isActive = item.dataset.page === currentPage;
      item.classList.toggle('active', isActive);
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    if (nav && indicator && activeItem) {
      const position = { target: 0, current: 0, velocity: 0 };
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let frameId = null;
      let lastTime = 0;

      function render() {
        indicator.style.transform = `translate3d(-3px, ${position.current}px, 0)`;
      }

      function animate(now) {
        const dt = Math.min((now - lastTime) / 1000, 1 / 30);
        lastTime = now;
        const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
        const step = dt / steps;
        for (let i = 0; i < steps; i++) {
          position.velocity += (260 * (position.target - position.current) - 22 * position.velocity) * step;
          position.current += position.velocity * step;
        }
        render();
        if (Math.abs(position.target - position.current) < .1 && Math.abs(position.velocity) < .1) {
          position.current = position.target;
          position.velocity = 0;
          render();
          frameId = null;
        } else {
          frameId = requestAnimationFrame(animate);
        }
      }

      function setTarget(item, instant = false) {
        position.target = item.offsetTop - 3;
        if (instant || reduceMotion) {
          position.current = position.target;
          position.velocity = 0;
          render();
          return;
        }
        if (frameId === null) {
          lastTime = performance.now();
          frameId = requestAnimationFrame(animate);
        }
      }

      navItems.forEach(item => {
        item.addEventListener('click', () => {
          navItems.forEach(link => link.removeAttribute('aria-current'));
          item.setAttribute('aria-current', 'page');
          setTarget(item);
        });
      });
      setTarget(activeItem, true);
      window.addEventListener('resize', () => setTarget(activeItem, true));
    }

    const morph = container.querySelector('.admin-mobile-morph');
    const trigger = container.querySelector('.admin-mobile-trigger');
    const panel = container.querySelector('.admin-mobile-panel');
    const morphDisp = container.querySelector('#admin-morph-disp');
    if (morph && trigger && panel) {
      const buttonSize = 64;
      const gap = 8;
      const panelWidth = 212;
      const spring = value => ({ x: value, v: 0, target: value, k: 200, c: 20 });
      const size = {
        width: spring(buttonSize),
        height: spring(buttonSize),
        radius: spring(32),
        scale: spring(1)
      };
      const tuneOpen = { k: 190, c: 17 };
      const tuneClose = { k: 200, c: 21 };
      const tunePress = { k: 300, c: 22 };
      const tuneBounce = { k: 420, c: 13 };
      const tuneReduced = { k: 400, c: 40 };
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let rafId = null;
      let lastTime = 0;
      let liquid = 0;
      let lastLiquidScale = -1;
      let isOpen = false;
      let isPressed = false;

      function tune(value, settings) {
        const selected = reduceMotion ? tuneReduced : settings;
        value.k = selected.k;
        value.c = selected.c;
      }

      function integrate(value, dt) {
        const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
        const step = dt / steps;
        for (let i = 0; i < steps; i++) {
          const force = value.k * (value.target - value.x) - value.c * value.v;
          value.v += force * step;
          value.x += value.v * step;
        }
      }

      function isResting(value) {
        return Math.abs(value.target - value.x) < .02 && Math.abs(value.v) < .05;
      }

      function renderFrame(dt) {
        morph.style.width = `${size.width.x}px`;
        morph.style.height = `${size.height.x}px`;
        morph.style.borderRadius = `${size.radius.x}px`;
        morph.style.transform = `scale(${size.scale.x})`;
        const speed = Math.hypot(size.width.v, size.height.v);
        const targetLiquid = reduceMotion ? 0 : Math.min(26, speed * .011);
        liquid = Math.max(targetLiquid, liquid * Math.pow(.88, dt * 60));
        if (liquid < .05) liquid = 0;
        if (Math.abs(liquid - lastLiquidScale) > .25) {
          if (morphDisp) morphDisp.setAttribute('scale', liquid.toFixed(2));
          lastLiquidScale = liquid;
        }
      }

      function allSettled() {
        return isResting(size.width) && isResting(size.height) &&
          isResting(size.radius) && isResting(size.scale) && liquid === 0;
      }

      function frame(now) {
        const dt = Math.min((now - lastTime) / 1000, 1 / 30);
        lastTime = now;
        integrate(size.width, dt);
        integrate(size.height, dt);
        integrate(size.radius, dt);
        integrate(size.scale, dt);
        renderFrame(dt);
        rafId = allSettled() ? null : requestAnimationFrame(frame);
      }

      function kick() {
        if (rafId === null) {
          lastTime = performance.now();
          rafId = requestAnimationFrame(frame);
        }
      }

      function releasePress() {
        if (!isPressed) return;
        isPressed = false;
        tune(size.scale, tuneBounce);
        size.scale.target = 1;
        kick();
      }

      function setOpen(value) {
        if (value === isOpen) return;
        isOpen = value;
        morph.classList.toggle('open', isOpen);
        trigger.classList.toggle('active', isOpen);
        trigger.setAttribute('aria-expanded', String(isOpen));
        const settings = isOpen ? tuneOpen : tuneClose;
        tune(size.width, settings);
        tune(size.height, settings);
        tune(size.radius, settings);
        size.width.target = isOpen ? panelWidth : buttonSize;
        size.height.target = isOpen ? buttonSize + gap + panel.offsetHeight : buttonSize;
        size.radius.target = isOpen ? 36 : 32;
        tune(size.scale, tuneBounce);
        size.scale.target = 1;
        kick();
      }

      trigger.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        isPressed = true;
        tune(size.scale, tunePress);
        size.scale.target = .84;
        kick();
      });
      trigger.addEventListener('pointerup', releasePress);
      trigger.addEventListener('pointerleave', releasePress);
      trigger.addEventListener('pointercancel', releasePress);
      trigger.addEventListener('click', event => {
        event.stopPropagation();
        if (event.detail === 0) {
          size.scale.x = .9;
          size.scale.v = 0;
          releasePress();
        }
        setOpen(!isOpen);
      });
      document.addEventListener('click', event => {
        if (isOpen && !morph.contains(event.target)) setOpen(false);
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') setOpen(false);
      });
      panel.querySelectorAll('.admin-mobile-item').forEach(item => {
        item.addEventListener('click', () => setOpen(false));
      });
      window.addEventListener('resize', () => {
        if (isOpen) {
          size.height.target = buttonSize + gap + panel.offsetHeight;
          kick();
        }
      });
      renderFrame(0);
    }

    container.querySelectorAll('.admin-glass-logout').forEach(button => {
      button.addEventListener('click', () => {
        if (!window.confirm('Apakah Anda yakin ingin keluar dari SiPresensi?')) return;
        if (window.SiPresensi && typeof window.SiPresensi.logout === 'function') {
          window.SiPresensi.logout();
        } else {
          window.location.href = '/login.html';
        }
      });
    });
  }
})();
