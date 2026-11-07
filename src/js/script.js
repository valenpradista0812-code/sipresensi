/* SiPresensi - interaksi ringan */

// Pilih status absensi (Hadir / Izin / Sakit / Alfa)
document.querySelectorAll(".status-group").forEach(function (group) {
  group.addEventListener("click", function (e) {
    var btn = e.target.closest(".st-btn");
    if (!btn) return;
    group.querySelectorAll(".st-btn").forEach(function (b) {
      b.className = "st-btn";
    });
    btn.classList.add("on-" + btn.dataset.status);
  });
});

// Toggle switch (halaman Pengaturan)
document.querySelectorAll(".toggle").forEach(function (t) {
  t.addEventListener("click", function () {
    t.classList.toggle("on");
    t.setAttribute("aria-checked", t.classList.contains("on"));
  });
});

// Tab periode (halaman Laporan)
document.querySelectorAll(".tabs").forEach(function (tabs) {
  tabs.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    tabs.querySelectorAll("button").forEach(function (b) {
      b.classList.remove("active");
    });
    btn.classList.add("active");
  });
});

// Pagination (halaman tabel)
document.querySelectorAll(".pager").forEach(function (pager) {
  pager.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-page]");
    if (!btn) return;
    pager.querySelectorAll("button[data-page]").forEach(function (b) {
      b.classList.remove("active");
    });
    btn.classList.add("active");
  });
});

// Tampilkan / sembunyikan kata sandi (halaman Login)
document.querySelectorAll("[data-toggle-pass]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var input = document.getElementById(btn.dataset.togglePass);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
  });
});
