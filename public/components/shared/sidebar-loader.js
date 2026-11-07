// Keep older pages on the same role-aware sidebar loader.
(function () {
  const loader = document.createElement('script');
  loader.src = '/src/js/sidebar-loader.js';
  document.head.appendChild(loader);
})();
