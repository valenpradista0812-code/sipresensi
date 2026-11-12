from machine import Pin, SPI, I2C, PWM, reset
import time
import ssd1306
import framebuf
import network
import json
import urequests
import urandom
import socket
import select
import gc
from mfrc522 import MFRC522

# =====================================
# KONFIGURASI UTAMA
# =====================================
SUARA_AKTIF = True
DEBOUNCE_MS = 2500
LEBAR = 128
TINGGI = 32                 # OLED 0,91" umumnya 128x32

WIFI_CONFIG_FILE = "wifi_config.json"
WIFI_CONNECT_TIMEOUT = 8    # detik per jaringan

# =====================================
# KONFIGURASI BACKEND SIPRESENSI
# =====================================
# Ganti IP di bawah dengan IPv4 laptop yang menjalankan Express.
SERVER_URL = "http://192.168.1.5:3000/api/iot/rfid"
HEARTBEAT_URL = "http://192.168.1.5:3000/api/iot-monitoring/heartbeat"
COMMANDS_URL = "http://192.168.1.5:3000/api/iot-monitoring/commands"
COMMAND_ACK_URL = "http://192.168.1.5:3000/api/iot-monitoring/commands/{}/ack"
RESTART_POLL_MS = 3000      # interval cek perintah restart dari admin

# Isi dengan nilai IOT_DEVICE_TOKEN dari file .env backend.
DEVICE_TOKEN = "SipresensiESP32_9xK7mP2qR8vL5nT4bW6zY1aC"
DEVICE_ID = "rfid-main"     # Harus sama dengan IOT_DEVICE_ID (default backend: rfid-main)
FIRMWARE_VERSION = "v1.0.0"

HTTP_TIMEOUT_MS = 10000

# =====================================
# WEB PANEL (RESET VIA BROWSER)
# =====================================
WEB_PORT = 80
_server_sock = None

HALAMAN_PANEL = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sipresensi IoT Panel</title>
<style>
  body { font-family: sans-serif; text-align: center; margin: 0; padding: 30px 15px; background:#f2f4f8; }
  h1 { color:#1f2d3d; font-size:22px; }
  .card { background:#fff; border-radius:14px; padding:25px; max-width:340px; margin:0 auto; box-shadow:0 4px 14px rgba(0,0,0,.08); }
  .status { display:inline-block; padding:6px 14px; border-radius:20px; background:#e6f7ee; color:#0a7a44; font-weight:bold; margin-bottom:20px; }
  .btn { display:block; width:100%; padding:18px; font-size:18px; font-weight:bold; border:none; border-radius:10px; cursor:pointer; margin-top:12px; }
  .btn-reset { background:#e53935; color:#fff; }
  .btn-reset:active { background:#b71c1c; }
  .info { font-size:12px; color:#889; margin-top:18px; line-height:1.5; }
</style>
</head>
<body>
  <div class="card">
    <h1>Sipresensi IoT Panel</h1>
    <div class="status">ONLINE</div>
    <button class="btn btn-reset" onclick="doReset()">RESET PERANGKAT</button>
    <div class="info">Perangkat akan restart. Kartu RFID tidak akan terbaca selama proses reboot (~5 detik).</div>
  </div>
<script>
function doReset() {
  if (!confirm('Yakin ingin reset perangkat?')) return;
  fetch('/reset')
    .then(r => r.text())
    .then(t => {
      document.body.innerHTML = '<div class="card"><h1>Merestart...</h1><p>Tunggu 5 detik lalu refresh halaman ini.</p></div>';
    })
    .catch(() => {
      document.body.innerHTML = '<div class="card"><h1>Merestart...</h1><p>Tunggu 5 detik lalu refresh halaman ini.</p></div>';
    });
}
</script>
</body>
</html>"""

# Jeda awal agar tegangan stabil
time.sleep(1)

# =====================================
# OLED SETUP (SDA=26, SCL=27)
# =====================================
i2c = I2C(0, scl=Pin(27), sda=Pin(26), freq=400000)
oled = ssd1306.SSD1306_I2C(LEBAR, TINGGI, i2c, 0x3C)
canvas = framebuf.FrameBuffer(bytearray(LEBAR * TINGGI // 8), LEBAR, TINGGI, framebuf.MONO_VLSB)

def tampilkan():
    for x in range(LEBAR):
        for y in range(TINGGI):
            oled.pixel(x, y, canvas.pixel(x, y))
    oled.show()

def x_tengah(teks, skala=1):
    lebar_teks = len(teks) * 8 * skala
    return max(0, (LEBAR - lebar_teks) // 2)

def tulis_besar(teks, x, y, skala=2):
    w = len(teks) * 8
    buf = bytearray(w)
    fb = framebuf.FrameBuffer(buf, w, 8, framebuf.MONO_HLSB)
    fb.fill(0)
    fb.text(teks, 0, 0, 1)
    for py in range(8):
        for px in range(w):
            if fb.pixel(px, py):
                ox = x + px * skala
                oy = y + py * skala
                for dy in range(skala):
                    for dx in range(skala):
                        canvas.pixel(ox + dx, oy + dy, 1)

def tulis_besar_tengah(teks, y, skala=2):
    tulis_besar(teks, x_tengah(teks, skala), y, skala)

def layar_idle():
    canvas.fill(0)
    canvas.text("TEMPELKAN", x_tengah("TEMPELKAN", 1), 3, 1)
    tulis_besar_tengah("KARTU", 13, 2)
    tampilkan()

def layar_splash():
    canvas.fill(0)
    tulis_besar_tengah("RFID", 4, 2)
    canvas.text("SIAP", x_tengah("SIAP", 1), 22, 1)
    tampilkan()

def layar_error():
    canvas.fill(0)
    canvas.text("ERROR", x_tengah("ERROR", 1), 4, 1)
    canvas.text("RESTART...", x_tengah("RESTART...", 1), 16, 1)
    tampilkan()

def layar_wifi(teks_baris1, teks_baris2=""):
    canvas.fill(0)
    canvas.text(teks_baris1, x_tengah(teks_baris1, 1), 4, 1)
    if teks_baris2:
        canvas.text(teks_baris2, x_tengah(teks_baris2, 1), 18, 1)
    tampilkan()

def gambar_sukses(nama, dx=0):
    canvas.fill(0)
    canvas.text("SUKSES", x_tengah("SUKSES", 1) + dx, 2, 1)
    if len(nama) <= 8:
        tulis_besar(nama, x_tengah(nama, 2) + dx, 12, 2)
    else:
        tulis_besar(nama, x_tengah(nama, 1) + dx, 16, 1)

def gambar_gagal(dx=0):
    canvas.fill(0)
    tulis_besar("GAGAL", x_tengah("GAGAL", 2) + dx, 3, 2)
    sub = "TIDAK TERDAFTAR"
    canvas.text(sub, x_tengah(sub, 1) + dx, 22, 1)

def anim_sukses(nama):
    for x0 in (32, 64, 96):
        gambar_sukses(nama)
        canvas.fill_rect(x0, 0, LEBAR - x0, TINGGI, 0)
        tampilkan()
        time.sleep(0.03)
    gambar_sukses(nama)
    tampilkan()

def anim_gagal():
    for dx in (-4, 4, -3, 3, -1, 1, 0):
        gambar_gagal(dx)
        tampilkan()
        time.sleep(0.03)

# =====================================
# LED & BUZZER
# =====================================
led_kuning = Pin(4, Pin.OUT)
led_merah  = Pin(2, Pin.OUT)

def led_standby():
    led_kuning.value(1)
    led_merah.value(0)

def led_mati():
    led_kuning.value(0)
    led_merah.value(0)

buzzer1 = PWM(Pin(32))
buzzer2 = PWM(Pin(33))
buzzer1.duty(0)
buzzer2.duty(0)

def bunyi(freq, durasi, volume=400):
    if not SUARA_AKTIF:
        time.sleep(durasi)
        return
    buzzer1.freq(freq)
    buzzer2.freq(freq)
    buzzer1.duty(volume)
    buzzer2.duty(volume)
    time.sleep(durasi)
    buzzer1.duty(0)
    buzzer2.duty(0)

NADA_SUKSES = [(1760, 0.08), (2637, 0.12)]
NADA_GAGAL = [(196, 0.20), (147, 0.40)]

def suara_sukses_led():
    for freq, durasi in NADA_SUKSES:
        led_kuning.value(1)
        bunyi(freq, durasi)
        led_kuning.value(0)
        time.sleep(0.04)

def suara_gagal_led():
    led_kuning.value(0)
    for freq, durasi in NADA_GAGAL:
        led_merah.value(1)
        bunyi(freq, durasi, volume=512)
        led_merah.value(0)
        time.sleep(0.05)

# =====================================
# MANAJEMEN WIFI
# =====================================
def load_wifi_list():
    try:
        with open(WIFI_CONFIG_FILE, "r") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            return []
    except OSError:
        print("File {} tidak ditemukan".format(WIFI_CONFIG_FILE))
        return []
    except Exception as e:
        print("Gagal membaca {}: {}".format(WIFI_CONFIG_FILE, e))
        return []

def connect_best_wifi():
    saved = load_wifi_list()
    if not saved:
        print("Tidak ada WiFi tersimpan")
        layar_wifi("WIFI KOSONG", "MODE OFFLINE")
        time.sleep(1.5)
        return None

    saved_map = {item["ssid"]: item["password"] for item in saved}
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    layar_wifi("SCAN WIFI...", "")
    try:
        nets = wlan.scan()
    except Exception as e:
        print("Pemindaian gagal:", e)
        layar_wifi("SCAN GAGAL", "MODE OFFLINE")
        time.sleep(1.5)
        return None

    candidates = []
    for net in nets:
        ssid_raw = net[0]
        try:
            ssid = ssid_raw.decode("utf-8") if isinstance(ssid_raw, bytes) else str(ssid_raw)
        except Exception:
            ssid = ""
        rssi = net[3]
        if ssid in saved_map:
            candidates.append((ssid, rssi, saved_map[ssid]))

    if not candidates:
        layar_wifi("WIFI TAK ADA", "MODE OFFLINE")
        time.sleep(1.5)
        return None

    candidates.sort(key=lambda x: x[1], reverse=True)
    for ssid, rssi, password in candidates:
        layar_wifi("KONEK KE", ssid[:16])
        try:
            wlan.disconnect()
        except Exception:
            pass
        time.sleep(0.3)
        try:
            wlan.connect(ssid, password)
        except Exception as e:
            continue

        start = time.time()
        while not wlan.isconnected() and (time.time() - start) < WIFI_CONNECT_TIMEOUT:
            time.sleep(0.3)

        if wlan.isconnected():
            ip = wlan.ifconfig()[0]
            layar_wifi("WIFI OK", ip)
            time.sleep(1.0)
            return wlan

    layar_wifi("WIFI GAGAL", "MODE OFFLINE")
    time.sleep(1.5)
    return None

# =====================================
# KOMUNIKASI BACKEND
# =====================================
def kirim_uid_backend(uid_string):
    if not wlan or not wlan.isconnected():
        return None

    event_id = "esp32-{}-{}-{}".format(uid_string.replace("-", ""), time.ticks_ms(), urandom.getrandbits(16))
    payload = {"uid": uid_string, "event_id": event_id}
    headers = {"Authorization": "Bearer " + DEVICE_TOKEN, "Content-Type": "application/json"}

    response = None
    try:
        response = urequests.post(SERVER_URL, data=json.dumps(payload), headers=headers)
        status = response.status_code
        try:
            raw = response.content
            if isinstance(raw, bytes): raw = raw.decode("utf-8")
            data = json.loads(raw) if raw.strip() else {}
        except Exception:
            data = {}
        if 200 <= status < 300 and not data:
            data = {"success": True, "_no_body": True}
        return status, data
    except Exception as e:
        print("Gagal mengirim UID:", e)
        return None
    finally:
        if response is not None:
            try: response.close()
            except Exception: pass
        gc.collect() # Bersihkan memori

def tampilkan_pesan(teks, baris_bawah=""):
    canvas.fill(0)
    teks = str(teks).upper()[:16]
    canvas.text(teks, x_tengah(teks), 4, 1)
    if baris_bawah:
        baris_bawah = str(baris_bawah).upper()[:16]
        canvas.text(baris_bawah, x_tengah(baris_bawah), 19, 1)
    tampilkan()

def proses_respons_backend(hasil):
    if hasil is None:
        tampilkan_pesan("KONEKSI GAGAL", "CEK WIFI/SERVER")
        aksi_error()
        return

    status, data = hasil
    berhasil = data.get("success") is True
    mode = data.get("mode")

    if not berhasil:
        if status == 401: tampilkan_pesan("TOKEN SALAH", "CEK KONFIGURASI")
        elif status == 404: tampilkan_pesan("KARTU TIDAK", "TERDAFTAR")
        elif status == 429: tampilkan_pesan("TUNGGU", "COBA LAGI")
        elif status == 403: tampilkan_pesan("AKUN NONAKTIF", "HUBUNGI GURU")
        elif status == 503: tampilkan_pesan("SERVER ERROR", "CEK BACKEND/DB")
        else: tampilkan_pesan("GAGAL DIPROSES", "COBA LAGI")
        aksi_error()
        return

    if data.get("_no_body"):
        tampilkan_pesan("BERHASIL", "DATA TERKIRIM")
        aksi_sukses("BERHASIL")
        return

    if mode == "registration":
        tampilkan_pesan("KARTU TERBACA", "UID DITERIMA")
        aksi_sukses("TERBACA")
        return

    if mode == "attendance":
        nama = data.get("name", "SISWA")
        if data.get("trackerStarted") is True: tampilkan_pesan("ABSENSI MULAI", nama)
        elif data.get("trackerStopped") is True: tampilkan_pesan("ABSENSI SELESAI", nama)
        elif data.get("isRunning") is True:
            sisa = data.get("secondsUntilStopAllowed")
            if sisa is not None: tampilkan_pesan("TIMER BERJALAN", "TUNGGU {} DTK".format(sisa))
            else: tampilkan_pesan("TIMER BERJALAN", nama)
        else: tampilkan_pesan("ABSENSI OK", nama)
        aksi_sukses(nama[:8] if nama else "BERHASIL")
        return

    if mode == "dispensasi":
        action = data.get("action", "")
        nama = data.get("name", "SISWA")
        if action == "started":
            tampilkan_pesan("DISP DIMULAI", nama)
            aksi_sukses("DIMULAI")
        elif action == "duplicate":
            tampilkan_pesan("TAP DUPLIKAT", "SUDAH DIPROSES")
            aksi_sukses("DUPLIKAT")
        else:
            tampilkan_pesan("DISP SELESAI", nama)
            aksi_sukses("SELESAI")
        return

    tampilkan_pesan("BERHASIL", "DATA TERKIRIM")
    aksi_sukses("BERHASIL")

def aksi_sukses(nama):
    anim_sukses(nama)
    suara_sukses_led()
    time.sleep(0.8)
    led_standby()

def aksi_gagal():
    anim_gagal()
    gambar_gagal()
    tampilkan()
    suara_gagal_led()
    time.sleep(1.0)
    led_standby()

def aksi_error():
    suara_gagal_led()
    time.sleep(1.0)
    led_standby()

def tunggu_kartu_pergi(timeout_ms=2000):
    kosong = 0
    mulai = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), mulai) < timeout_ms:
        stat, _ = rfid.request(rfid.REQIDL)
        if stat != rfid.OK:
            kosong += 1
            if kosong >= 3: return
        else:
            kosong = 0
        time.sleep_ms(60)

# =====================================
# WEB SERVER & HEARTBEAT
# =====================================
def web_mulai():
    global _server_sock
    try:
        _server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        _server_sock.bind(('', WEB_PORT))
        _server_sock.listen(2)
        _server_sock.setblocking(False)
        ip = wlan.ifconfig()[0] if wlan and wlan.isconnected() else "0.0.0.0"
        print("Web panel aktif: http://{}/".format(ip))
        return True
    except Exception as e:
        print("Gagal start web server:", e)
        _server_sock = None
        return False

def web_tangani_request(conn):
    minta_reset = False
    try:
        conn.settimeout(0.5)
        try: req = conn.recv(1024).decode("utf-8", "ignore")
        except Exception:
            conn.close()
            return False

        baris = req.split("\r\n", 1)[0]
        path = baris.split(" ")[1] if len(baris.split(" ")) >= 2 else ""

        if path.startswith("/reset"):
            body = "<html><body style='text-align:center;padding:40px;'><h2>Perangkat di-reset...</h2><p>Tunggu beberapa detik.</p></body></html>"
            header = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n"
            conn.sendall(header.encode() + body.encode())
            minta_reset = True
        elif path == "/" or path.startswith("/index"):
            header = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n"
            conn.sendall(header.encode() + HALAMAN_PANEL.encode())
        elif path == "/status":
            body = '{"ok":true,"ip":"%s"}' % (wlan.ifconfig()[0] if wlan and wlan.isconnected() else "")
            header = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n"
            conn.sendall(header.encode() + body.encode())
        else:
            header = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n"
            conn.sendall(header.encode() + b"404")
    except Exception as e:
        print("Web req error:", e)
    finally:
        try: conn.close()
        except Exception: pass
    return minta_reset

def web_poll():
    if _server_sock is None: return False
    try:
        r, _, _ = select.select([_server_sock], [], [], 0)
    except Exception: return False
    if not r: return False
    try: conn, _ = _server_sock.accept()
    except Exception: return False
    return web_tangani_request(conn)

# Variabel untuk Heartbeat
waktu_heartbeat_terakhir = 0
uid_terakhir = ""          # UID kartu terakhir yang terbaca (untuk laporan heartbeat)

def kirim_heartbeat():
    global waktu_heartbeat_terakhir
    if not wlan or not wlan.isconnected(): return

    # Kirim setiap 15 detik
    if time.ticks_diff(time.ticks_ms(), waktu_heartbeat_terakhir) > 15000:
        try:
            rssi = wlan.status('rssi') if hasattr(wlan, 'status') else -60
            ip = wlan.ifconfig()[0]
            ssid = wlan.config('essid') if hasattr(wlan, 'config') else "Connected"

            payload = {
                "device_id": DEVICE_ID,
                "device_name": "RFID SiPresensi",
                "firmware_version": FIRMWARE_VERSION,
                "wifi": {
                    "connected": wlan.isconnected(),
                    "ssid": ssid,
                    "ip": ip,
                    "rssi": rssi
                },
                "rfid": {
                    "initialized": True,
                    "connected": True,
                    "last_uid": uid_terakhir or None
                }
            }
            headers = {"Authorization": "Bearer " + DEVICE_TOKEN, "Content-Type": "application/json"}

            # Gunakan timeout yang lebih pendek agar tidak memblokir loop RFID lama
            res = urequests.post(HEARTBEAT_URL, data=json.dumps(payload), headers=headers, timeout=5)
            print("Heartbeat terkirim, RSSI:", rssi, "status:", res.status_code)
            res.close()
        except Exception as e:
            print("Gagal kirim heartbeat:", e)
        finally:
            waktu_heartbeat_terakhir = time.ticks_ms()
            gc.collect()

def konfirmasi_perintah(command_id):
    # Konfirmasi perintah sudah diterima; urut: ack dulu, baru reboot agar
    # server mencatat restart_acknowledged sebelum perangkat offline.
    if not command_id: return
    try:
        res = urequests.post(
            COMMAND_ACK_URL.format(command_id),
            data=json.dumps({"status": "acknowledged"}),
            headers={"Authorization": "Bearer " + DEVICE_TOKEN, "Content-Type": "application/json"},
            timeout=5
        )
        ok = res.status_code in (200, 201, 202)
        try: res.close()
        except Exception: pass
        if ok:
            print("Perintah restart diterima, reboot...")
            tampilkan_pesan("RESTART", "DARI WEB...")
            led_mati()
            time.sleep(1)
            reset()
    except Exception as e:
        print("Gagal konfirmasi perintah:", e)

waktu_cek_perintah_terakhir = 0

def cek_perintah():
    global waktu_cek_perintah_terakhir
    if not wlan or not wlan.isconnected(): return

    if time.ticks_diff(time.ticks_ms(), waktu_cek_perintah_terakhir) < RESTART_POLL_MS: return
    waktu_cek_perintah_terakhir = time.ticks_ms()

    try:
        res = urequests.get(COMMANDS_URL, headers={"Authorization": "Bearer " + DEVICE_TOKEN}, timeout=5)
        try:
            data = res.json()
        except Exception:
            data = {}
        try: res.close()
        except Exception: pass
        if res.status_code == 200 and data.get("success") and data.get("data"):
            for cmd in data["data"]:
                if cmd.get("command") == "restart" and cmd.get("status") == "pending":
                    print("[MON] Perintah restart diterima dari backend:", cmd.get("id"))
                    konfirmasi_perintah(cmd.get("id"))
    except Exception as e:
        print("Gagal cek perintah:", e)
    finally:
        gc.collect()

# =====================================
# RFID SETUP
# =====================================
def init_rfid(percobaan=5):
    for i in range(percobaan):
        try:
            spi = SPI(2, baudrate=1000000, polarity=0, phase=0, sck=Pin(21), mosi=Pin(12), miso=Pin(22))
            return MFRC522(spi, gpioRst=5, gpioCs=13)
        except Exception as e:
            print("RFID gagal init, coba lagi:", e)
            time.sleep(0.5)
    raise OSError("RFID tidak terdeteksi")

# =====================================
# PROGRAM UTAMA
# =====================================
def jalankan():
    global rfid, wlan, uid_terakhir, waktu_heartbeat_terakhir

    led_standby()
    layar_wifi("BOOT...", "CARI WIFI")
    time.sleep(0.4)

    wlan = connect_best_wifi()
    if wlan:
        print("WiFi siap, IP:", wlan.ifconfig()[0])
        web_mulai()
        print("[MON] Build OK: heartbeat monitoring + polling perintah restart AKTIF")
        # Kirim heartbeat pertama segera setelah konek
        waktu_heartbeat_terakhir = 0
        kirim_heartbeat()
    else:
        print("Tidak terhubung WiFi, lanjut mode offline")

    rfid = init_rfid()
    layar_splash()
    time.sleep(0.6)

    waktu_terakhir = 0
    perlu_gambar_idle = True

    while True:
        # 1. Cek Web Server (Tombol Reset)
        if web_poll():
            tampilkan_pesan("RESET", "VIA WEB...")
            led_mati()
            time.sleep(1)
            reset()

        # 2. Kirim Heartbeat (detak jantung ke web)
        kirim_heartbeat()

        # 3. Cek perintah restart dari halaman admin
        cek_perintah()

        # 4. Tampilan Idle
        if perlu_gambar_idle:
            led_standby()
            layar_idle()
            perlu_gambar_idle = False

        # 5. Baca Kartu
        stat, _ = rfid.request(rfid.REQIDL)
        if stat == rfid.OK:
            stat, uid = rfid.anticoll()
            if stat == rfid.OK:
                uid_string = "-".join("{:02X}".format(x) for x in uid)
                sekarang = time.ticks_ms()
                
                if uid_string == uid_terakhir and time.ticks_diff(sekarang, waktu_terakhir) < DEBOUNCE_MS:
                    time.sleep_ms(50)
                    continue

                uid_terakhir = uid_string
                waktu_terakhir = sekarang

                print("UID:", uid_string)
                hasil = kirim_uid_backend(uid_string)
                proses_respons_backend(hasil)

                tunggu_kartu_pergi()
                perlu_gambar_idle = True

        time.sleep_ms(50)

# =====================================
# START
# =====================================
try:
    jalankan()
except Exception as e:
    print("FATAL ERROR:", e)
    led_mati()
    led_merah.value(1)
    try: layar_error()
    except Exception: pass
    time.sleep(2)
    reset()