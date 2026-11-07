document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const logoutButton = target.closest('.btn-logout');
  if (!logoutButton) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  window.location.assign('/logout');
}, true);
