(function () {
  const container = document.getElementById('sidebar-container');
  if (!container || !document.body.classList.contains('student-glass-page')) return;

  container.innerHTML = `
    <div class="student-glass-group">
      <div class="student-glass-buttons" aria-label="Aksi siswa">
        <button class="student-glass-circle glass-top-item" type="button" aria-label="Profil" title="Profile">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
        </button>
        <button class="student-glass-circle glass-top-item" type="button" aria-label="Notifikasi" title="Notifikasi">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>
        </button>
        <button class="student-glass-circle btn-logout" type="button" aria-label="Keluar" title="Keluar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
      <aside class="student-glass-sidebar" aria-label="Navigasi siswa">
        <nav class="student-glass-nav" aria-label="Menu utama">
          <span class="student-glass-indicator" aria-hidden="true"></span>
          <a class="student-glass-nav-item" href="/src/pages/student/dashboardsiswa.html" aria-label="Dashboard" title="Dashboard">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>
          </a>
          <a class="student-glass-nav-item" href="/src/pages/student/detail-absensi.html" aria-label="Absensi" title="Absensi">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>
          </a>
        </nav>
      </aside>
    </div>
    <div class="student-glass-morph">
      <div class="student-glass-surface" aria-hidden="true"></div>
      <nav class="student-glass-panel" aria-label="Menu siswa">
        <a class="student-glass-menu-item" href="/src/pages/student/dashboardsiswa.html" data-page="dashboardsiswa.html">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg><span>Dashboard</span>
        </a>
        <a class="student-glass-menu-item" href="/src/pages/student/detail-absensi.html" data-page="detail-absensi.html">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg><span>Absensi</span>
        </a>
        <div class="student-glass-divider"></div>
        <button class="student-glass-menu-item glass-top-item" type="button" aria-label="Profil" title="Profile" data-page="profil.html">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>Profil</span>
        </button>
        <button class="student-glass-menu-item glass-top-item" type="button" aria-label="Notifikasi" title="Notifikasi" data-page="notifikasi.html">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg><span>Notifikasi</span>
        </button>
        <div class="student-glass-divider"></div>
        <button class="student-glass-menu-item btn-logout" type="button" aria-label="Keluar" title="Keluar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Keluar</span>
        </button>
      </nav>
      <button class="student-glass-trigger" type="button" aria-label="Menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  `;

  const currentPage = window.location.pathname.split('/').pop();
  const morph = container.querySelector('.student-glass-morph');
  const trigger = container.querySelector('.student-glass-trigger');
  const panel = container.querySelector('.student-glass-panel');
  const nav = container.querySelector('.student-glass-nav');
  const indicator = container.querySelector('.student-glass-indicator');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const activeMenuItem = panel.querySelector(`[data-page="${currentPage}"]`);
  if (activeMenuItem) activeMenuItem.classList.add('active');

  const activeNavItem = Array.from(nav.querySelectorAll('.student-glass-nav-item'))
    .find(item => new URL(item.href).pathname === window.location.pathname);
  if (activeNavItem) {
    activeNavItem.setAttribute('aria-current', 'page');
    indicator.style.transform = `translate3d(-3px, ${activeNavItem.offsetTop - 3}px, 0)`;
  } else {
    indicator.hidden = true;
  }

  const buttonSize = 64;
  const panelWidth = 212;
  const gap = 8;
  const spring = (value, k = 200, c = 20) => ({ x: value, v: 0, target: value, k, c });
  const size = {
    width: spring(buttonSize),
    height: spring(buttonSize),
    radius: spring(32),
    scale: spring(1)
  };
  let open = false;
  let frameId = null;
  let lastTime = 0;
  let liquid = 0;

  function tune(value, k, c) {
    value.k = reducedMotion ? 400 : k;
    value.c = reducedMotion ? 40 : c;
  }

  function settle(value) {
    return Math.abs(value.target - value.x) < .02 && Math.abs(value.v) < .05;
  }

  function render(now) {
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;
    [size.width, size.height, size.radius, size.scale].forEach(value => {
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const step = dt / steps;
      for (let i = 0; i < steps; i++) {
        value.v += (value.k * (value.target - value.x) - value.c * value.v) * step;
        value.x += value.v * step;
      }
    });

    morph.style.width = `${size.width.x}px`;
    morph.style.height = `${size.height.x}px`;
    morph.style.borderRadius = `${size.radius.x}px`;
    morph.style.transform = `scale(${size.scale.x})`;
    const speed = Math.hypot(size.width.v, size.height.v);
    liquid = Math.max(reducedMotion ? 0 : Math.min(20, speed * .01), liquid * Math.pow(.88, dt * 60));
    morph.style.setProperty('--student-liquid-motion', `${liquid}px`);

    if ([size.width, size.height, size.radius, size.scale].every(settle) && liquid < .05) {
      liquid = 0;
      morph.style.removeProperty('--student-liquid-motion');
      frameId = null;
      return;
    }
    frameId = requestAnimationFrame(render);
  }

  function animate() {
    if (frameId !== null) return;
    lastTime = performance.now();
    frameId = requestAnimationFrame(render);
  }

  function setOpen(value) {
    if (open === value) return;
    open = value;
    morph.classList.toggle('open', open);
    trigger.classList.toggle('active', open);
    trigger.setAttribute('aria-expanded', String(open));
    [size.width, size.height, size.radius].forEach(item => tune(item, open ? 190 : 200, open ? 17 : 21));
    size.width.target = open ? panelWidth : buttonSize;
    size.height.target = open ? buttonSize + gap + panel.offsetHeight : buttonSize;
    size.radius.target = open ? 36 : 32;
    tune(size.scale, open ? 420 : 420, 13);
    size.scale.target = 1;
    animate();
  }

  let pressed = false;
  trigger.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pressed = true;
    tune(size.scale, 300, 22);
    size.scale.target = .84;
    animate();
  });
  const release = () => {
    if (!pressed) return;
    pressed = false;
    tune(size.scale, 420, 13);
    size.scale.target = 1;
    animate();
  };
  trigger.addEventListener('pointerup', release);
  trigger.addEventListener('pointerleave', release);
  trigger.addEventListener('pointercancel', release);
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    setOpen(!open);
  });
  document.addEventListener('click', event => {
    if (open && !morph.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setOpen(false);
  });
  window.addEventListener('resize', () => {
    if (open) {
      size.height.target = buttonSize + gap + panel.offsetHeight;
      animate();
    }
  });
})();
