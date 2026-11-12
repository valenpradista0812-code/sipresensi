from machine import Pin, SPI, I2C, PWM, reset
import time
import ssd1306
import framebuf
import network
import json
import urequests
import urandom
try:
    import _thread
except ImportError:
    _thread = None
from mfrc522 import MFRC522


# =====================================
# KONFIGURASI
# =====================================

SUARA_AKTIF = True
DEBOUNCE_MS = 2500
LEBAR = 128
TINGGI = 32                 # OLED 0,91" umumnya 128x32

WIFI_CONFIG_FILE = "wifi_config.json"
# Keep this file on the ESP32 only; it contains the device token.
DEVICE_CONFIG_FILE = "device_config.json"
WIFI_CONNECT_TIMEOUT = 8    # detik per jaringan

# =====================================
# KONFIGURASI BACKEND SIPRESENSI
# =====================================
# Ganti IP di bawah dengan IPv4 laptop yang menjalankan Express.
# Contoh: http://192.168.1.10:3000/api/iot/rfid
SERVER_URL = "http://192.168.1.5:3000/api/iot/rfid"

MONITOR_BASE_URL = SERVER_URL.rsplit("/api/iot/rfid", 1)[0] + "/api/iot-monitoring"
FIRMWARE_VERSION = "2026.11.08"
HEARTBEAT_INTERVAL_MS = 15000
COMMAND_POLL_INTERVAL_MS = 5000
MONITOR_TIMEOUT_SECONDS = 2

HTTP_TIMEOUT_MS = 10000


def load_device_config():
    try:
        with open(DEVICE_CONFIG_FILE, "r") as config_file:
            config = json.load(config_file)
    except OSError:
        print("File {} tidak ditemukan; monitoring perangkat nonaktif".format(DEVICE_CONFIG_FILE))
        return {}
    except Exception as error:
        print("Konfigurasi perangkat tidak valid:", error)
        return {}

    if not isinstance(config, dict):
        print("Format {} tidak valid (harus object JSON)".format(DEVICE_CONFIG_FILE))
        return {}
    return config


DEVICE_CONFIG = load_device_config()
DEVICE_TOKEN = DEVICE_CONFIG.get("device_token", "")
if not isinstance(DEVICE_TOKEN, str):
    DEVICE_TOKEN = ""
DEVICE_ID = DEVICE_CONFIG.get("device_id", "rfid-main")
if not isinstance(DEVICE_ID, str) or not DEVICE_ID:
    DEVICE_ID = "rfid-main"
HTTP_LOCK = _thread.allocate_lock() if _thread else None
STATE_LOCK = _thread.allocate_lock() if _thread else None
monitor_state = {
    "rfid_initialized": False,
    "rfid_connected": None,
    "last_uid": None,
    "last_read_at": None,
    "error": None
}

# Jeda awal agar tegangan dari baterai/adaptor stabil
time.sleep(1)


# =====================================
# OLED SETUP (SDA=26, SCL=27)
# =====================================

i2c = I2C(0, scl=Pin(27), sda=Pin(26), freq=400000)
oled = ssd1306.SSD1306_I2C(LEBAR, TINGGI, i2c, 0x3C)

# Canvas: semua gambar dibuat di sini, lalu disalin ke OLED
canvas = framebuf.FrameBuffer(bytearray(LEBAR * TINGGI // 8),
                              LEBAR, TINGGI, framebuf.MONO_VLSB)


def tampilkan():
    """Salin canvas ke OLED."""
    for x in range(LEBAR):
        for y in range(TINGGI):
            oled.pixel(x, y, canvas.pixel(x, y))
    oled.show()


# =====================================
# HELPER TEKS
# =====================================

def x_tengah(teks, skala=1):
    lebar_teks = len(teks) * 8 * skala
    return max(0, (LEBAR - lebar_teks) // 2)


def tulis_besar(teks, x, y, skala=2):
    """Teks diperbesar, digambar ke canvas."""
    w = len(teks) * 8
    buf = bytearray(w)                       # MONO_HLSB: 8 baris
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


# =====================================
# LAYAR
# =====================================

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
    """Layar status WiFi saat boot."""
    canvas.fill(0)
    canvas.text(teks_baris1, x_tengah(teks_baris1, 1), 4, 1)
    if teks_baris2:
        canvas.text(teks_baris2, x_tengah(teks_baris2, 1), 18, 1)
    tampilkan()


def gambar_sukses(nama, dx=0):
    """Layar sukses: 'SUKSES' kecil di atas, nama besar di tengah."""
    canvas.fill(0)
    canvas.text("SUKSES", x_tengah("SUKSES", 1) + dx, 2, 1)

    if len(nama) <= 8:
        tulis_besar(nama, x_tengah(nama, 2) + dx, 12, 2)
    else:
        tulis_besar(nama, x_tengah(nama, 1) + dx, 16, 1)


def gambar_gagal(dx=0):
    """Layar gagal: 'GAGAL' besar di atas, pesan kecil di bawah."""
    canvas.fill(0)
    tulis_besar("GAGAL", x_tengah("GAGAL", 2) + dx, 3, 2)
    sub = "TIDAK TERDAFTAR"
    canvas.text(sub, x_tengah(sub, 1) + dx, 22, 1)


# =====================================
# ANIMASI (singkat, untuk antrian)
# =====================================

def anim_sukses(nama):
    """Wipe dari kiri ke kanan, total ~0.1 detik."""
    for x0 in (32, 64, 96):
        gambar_sukses(nama)
        canvas.fill_rect(x0, 0, LEBAR - x0, TINGGI, 0)
        tampilkan()
        time.sleep(0.03)
    gambar_sukses(nama)
    tampilkan()


def anim_gagal():
    """Getar singkat, total ~0.25 detik."""
    for dx in (-4, 4, -3, 3, -1, 1, 0):
        gambar_gagal(dx)
        tampilkan()
        time.sleep(0.03)


# =====================================
# LED (Kuning=GPIO 4, Merah=GPIO 2)
# =====================================

led_kuning = Pin(4, Pin.OUT)
led_merah  = Pin(2, Pin.OUT)


def led_standby():
    led_kuning.value(1)
    led_merah.value(0)


def led_mati():
    led_kuning.value(0)
    led_merah.value(0)


# =====================================
# BUZZER (2 buah, GPIO 32 & 33)
# =====================================

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


# SUKSES: dua nada NAIK, tinggi dan cerah ("ting-ting")
NADA_SUKSES = [(1760, 0.08), (2637, 0.12)]

# GAGAL: dua nada TURUN, rendah dan berat ("bzzt...")
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
# MANAJEMEN WIFI (MULTI-SSID, PILIH TERKUAT)
# =====================================

def load_wifi_list():
    """Baca daftar WiFi yang tersimpan dari file JSON."""
    try:
        with open(WIFI_CONFIG_FILE, "r") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            print("Format wifi_config.json tidak valid (harus list)")
            return []
    except OSError:
        print("File {} tidak ditemukan".format(WIFI_CONFIG_FILE))
        return []
    except Exception as e:
        print("Gagal membaca {}: {}".format(WIFI_CONFIG_FILE, e))
        return []


def connect_best_wifi():
    """
    Pindai jaringan, cocokkan dengan daftar tersimpan,
    urutkan berdasarkan RSSI (terkuat dulu), lalu hubungkan.
    Mengembalikan objek WLAN jika berhasil, None jika gagal.
    """
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
    print("Memindai jaringan sekitar...")
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
        print("Tidak ada jaringan tersimpan di sekitar")
        layar_wifi("WIFI TAK ADA", "MODE OFFLINE")
        time.sleep(1.5)
        return None

    # Urutkan RSSI dari kuat ke lemah
    candidates.sort(key=lambda x: x[1], reverse=True)
    print("Kandidat WiFi (urut RSSI):")
    for ssid, rssi, _ in candidates:
        print("  {}  RSSI={}".format(ssid, rssi))

    for ssid, rssi, password in candidates:
        print("Mencoba {} (RSSI={})...".format(ssid, rssi))
        layar_wifi("KONEK KE", ssid[:16])
        try:
            wlan.disconnect()
        except Exception:
            pass
        time.sleep(0.3)

        try:
            wlan.connect(ssid, password)
        except Exception as e:
            print("  Panggilan connect error:", e)
            continue

        start = time.time()
        while not wlan.isconnected() and (time.time() - start) < WIFI_CONNECT_TIMEOUT:
            time.sleep(0.3)

        if wlan.isconnected():
            ip = wlan.ifconfig()[0]
            print("  Terhubung, IP:", ip)
            layar_wifi("WIFI OK", ip)
            time.sleep(1.0)
            return wlan
        else:
            print("  Timeout, coba berikutnya")

    print("Semua jaringan tersimpan gagal")
    layar_wifi("WIFI GAGAL", "MODE OFFLINE")
    time.sleep(1.5)
    return None


# =====================================
# KOMUNIKASI BACKEND SIPRESENSI
# =====================================

def kirim_uid_backend(uid_string):
    """Kirim UID ke Express dan kembalikan (HTTP status, JSON response)."""
    if not wlan or not wlan.isconnected():
        print("Backend tidak dapat dihubungi: WiFi terputus")
        return None

    if not DEVICE_TOKEN or DEVICE_TOKEN == "GANTI_DENGAN_IOT_DEVICE_TOKEN":
        print("DEVICE_TOKEN belum dikonfigurasi")
        return None

    # --- PERBAIKAN: event_id dengan nonce acak (aman setelah reboot) ---
    event_id = "esp32-{}-{}-{}".format(
        uid_string.replace("-", ""),
        time.ticks_ms(),
        urandom.getrandbits(16)
    )
    payload = {
        "uid": uid_string,
        "event_id": event_id
    }
    headers = {
        "Authorization": "Bearer " + DEVICE_TOKEN,
        "Content-Type": "application/json"
    }

    response = None
    if HTTP_LOCK:
        HTTP_LOCK.acquire()
    try:
        response = urequests.post(
            SERVER_URL,
            data=json.dumps(payload),
            headers=headers,
            timeout=HTTP_TIMEOUT_MS // 1000
        )
        status = response.status_code

        # --- PERBAIKAN: parsing JSON manual + log detail ---
        try:
            raw = response.content
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            print("BODY RAW:", repr(raw))
            data = json.loads(raw) if raw.strip() else {}
        except Exception as e:
            print("GAGAL PARSE JSON:", repr(e))
            data = {}

        print("HTTP:", status)
        print("RESPONS BACKEND:", data)

        # --- PERBAIKAN: fallback jika HTTP 2xx tapi body kosong/rusak ---
        if 200 <= status < 300 and not data:
            data = {"success": True, "_no_body": True}

        return status, data

    except Exception as e:
        print("Gagal mengirim UID ke backend:", e)
        return None

    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
        if HTTP_LOCK:
            HTTP_LOCK.release()


def update_monitor_state(**values):
    if STATE_LOCK:
        STATE_LOCK.acquire()
    try:
        monitor_state.update(values)
    finally:
        if STATE_LOCK:
            STATE_LOCK.release()


def get_monitor_state():
    if STATE_LOCK:
        STATE_LOCK.acquire()
    try:
        return monitor_state.copy()
    finally:
        if STATE_LOCK:
            STATE_LOCK.release()


def parse_json_response(response):
    raw = response.content
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(raw) if raw.strip() else {}


def utc_now_iso():
    current = time.gmtime()
    if current[0] < 2022:
        return None
    return "{:04d}-{:02d}-{:02d}T{:02d}:{:02d}:{:02d}Z".format(
        current[0], current[1], current[2], current[3], current[4], current[5]
    )


def send_device_heartbeat():
    if not DEVICE_TOKEN or not wlan or not wlan.isconnected():
        return

    try:
        ssid = wlan.config("essid")
        if isinstance(ssid, bytes):
            ssid = ssid.decode("utf-8")
    except Exception:
        ssid = None
    try:
        ip_address = wlan.ifconfig()[0]
    except Exception:
        ip_address = None
    try:
        rssi = wlan.status("rssi")
        if not isinstance(rssi, int) or rssi < -127 or rssi > 0:
            rssi = None
    except Exception:
        rssi = None

    state = get_monitor_state()
    payload = {
        "device_id": DEVICE_ID,
        "device_name": "RFID SiPresensi",
        "firmware_version": FIRMWARE_VERSION,
        "wifi": {
            "connected": wlan.isconnected(),
            "ssid": ssid,
            "ip": ip_address,
            "rssi": rssi
        },
        "rfid": {
            "initialized": state["rfid_initialized"],
            "connected": state["rfid_connected"],
            "last_uid": state["last_uid"],
            "last_read_at": state["last_read_at"],
            "error": state["error"]
        }
    }
    response = None
    if HTTP_LOCK:
        HTTP_LOCK.acquire()
    try:
        response = urequests.post(
            MONITOR_BASE_URL + "/heartbeat",
            data=json.dumps(payload),
            headers={
                "Authorization": "Bearer " + DEVICE_TOKEN,
                "Content-Type": "application/json"
            },
            timeout=MONITOR_TIMEOUT_SECONDS
        )
        if response.status_code < 200 or response.status_code >= 300:
            raise OSError("Heartbeat HTTP {}".format(response.status_code))
        print("Heartbeat perangkat terkirim")
    except Exception as error:
        print("Gagal mengirim heartbeat:", error)
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
        if HTTP_LOCK:
            HTTP_LOCK.release()


def acknowledge_restart(command_id):
    response = None
    if HTTP_LOCK:
        HTTP_LOCK.acquire()
    try:
        response = urequests.post(
            MONITOR_BASE_URL + "/commands/{}/ack".format(command_id),
            data=json.dumps({"status": "acknowledged"}),
            headers={
                "Authorization": "Bearer " + DEVICE_TOKEN,
                "Content-Type": "application/json"
            },
            timeout=MONITOR_TIMEOUT_SECONDS
        )
        result = parse_json_response(response)
        if response.status_code < 200 or response.status_code >= 300 or not result.get("success"):
            print("Konfirmasi restart ditolak:", response.status_code)
            return False
        return True
    except Exception as error:
        print("Gagal mengonfirmasi restart:", error)
        return False
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
        if HTTP_LOCK:
            HTTP_LOCK.release()


def poll_device_commands():
    if not DEVICE_TOKEN or not wlan or not wlan.isconnected():
        return

    response = None
    if HTTP_LOCK:
        HTTP_LOCK.acquire()
    try:
        response = urequests.get(
            MONITOR_BASE_URL + "/commands",
            headers={"Authorization": "Bearer " + DEVICE_TOKEN},
            timeout=MONITOR_TIMEOUT_SECONDS
        )
        result = parse_json_response(response)
        if response.status_code < 200 or response.status_code >= 300 or not result.get("success"):
            raise OSError("Polling command HTTP {}".format(response.status_code))
        commands = result.get("data", [])
        if not isinstance(commands, list):
            raise OSError("Format daftar perintah perangkat tidak valid")
    except Exception as error:
        print("Gagal memeriksa perintah perangkat:", error)
        return
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
        if HTTP_LOCK:
            HTTP_LOCK.release()

    for command in commands:
        if isinstance(command, dict) and command.get("command") == "restart" and command.get("id"):
            print("Menerima perintah restart dari backend")
            if acknowledge_restart(command.get("id")):
                time.sleep_ms(100)
                reset()


def monitoring_worker():
    last_heartbeat = None
    last_command_check = None
    while True:
        now = time.ticks_ms()
        if wlan and wlan.isconnected() and DEVICE_TOKEN:
            if last_heartbeat is None or time.ticks_diff(now, last_heartbeat) >= HEARTBEAT_INTERVAL_MS:
                last_heartbeat = now
                send_device_heartbeat()
            if last_command_check is None or time.ticks_diff(now, last_command_check) >= COMMAND_POLL_INTERVAL_MS:
                last_command_check = now
                poll_device_commands()
        time.sleep_ms(250)


def start_monitoring():
    if not DEVICE_TOKEN:
        print("Monitoring nonaktif: provision device_token di {}".format(DEVICE_CONFIG_FILE))
        return
    if not _thread:
        print("Monitoring nonaktif: modul _thread tidak tersedia")
        return
    try:
        _thread.start_new_thread(monitoring_worker, ())
    except Exception as error:
        print("Gagal menjalankan thread monitoring:", error)


def tampilkan_pesan(teks, baris_bawah=""):
    """Tampilkan pesan pendek di OLED 128x32."""
    canvas.fill(0)
    teks = str(teks).upper()[:16]
    canvas.text(teks, x_tengah(teks), 4, 1)
    if baris_bawah:
        baris_bawah = str(baris_bawah).upper()[:16]
        canvas.text(baris_bawah, x_tengah(baris_bawah), 19, 1)
    tampilkan()


def proses_respons_backend(hasil):
    """Terjemahkan respons endpoint RFID menjadi indikator OLED/LED/buzzer."""
    if hasil is None:
        tampilkan_pesan("KONEKSI GAGAL", "CEK WIFI/SERVER")
        aksi_error()
        return

    status, data = hasil
    berhasil = data.get("success") is True
    pesan = data.get("message", "Permintaan gagal diproses")
    mode = data.get("mode")

    print("PESAN:", pesan)

    if not berhasil:
        # Tampilkan penyebab dari server, bukan selalu menganggap kartu tidak terdaftar.
        if status == 401:
            tampilkan_pesan("TOKEN SALAH", "CEK KONFIGURASI")
        elif status == 404:
            tampilkan_pesan("KARTU TIDAK", "TERDAFTAR")
        elif status == 429:
            tampilkan_pesan("TUNGGU", "COBA LAGI")
        elif status == 403:
            tampilkan_pesan("AKUN NONAKTIF", "HUBUNGI GURU")
        elif status == 503:
            tampilkan_pesan("SERVER ERROR", "CEK BACKEND/DB")
        elif status == 409:
            tampilkan_pesan("DISPENSASI", "DURASI SALAH")
        else:
            tampilkan_pesan("GAGAL DIPROSES", "COBA LAGI")
        aksi_error()
        return

    # --- PERBAIKAN: kasus sukses tanpa body JSON ---
    if data.get("_no_body"):
        tampilkan_pesan("BERHASIL", "DATA TERKIRIM")
        aksi_sukses("BERHASIL")
        return

    if mode == "registration":
        # UID sudah diterima oleh sesi Baca Kartu di halaman Data Siswa.
        tampilkan_pesan("KARTU TERBACA", "UID DITERIMA")
        aksi_sukses("TERBACA")
        return

    if mode == "attendance":
        nama = data.get("name", "SISWA")
        if data.get("trackerStarted") is True:
            tampilkan_pesan("ABSENSI MULAI", nama)
        elif data.get("trackerStopped") is True:
            tampilkan_pesan("ABSENSI SELESAI", nama)
        elif data.get("isRunning") is True:
            sisa = data.get("secondsUntilStopAllowed")
            if sisa is not None:
                tampilkan_pesan("TIMER BERJALAN", "TUNGGU {} DTK".format(sisa))
            else:
                tampilkan_pesan("TIMER BERJALAN", nama)
        else:
            tampilkan_pesan("ABSENSI OK", nama)
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


# =====================================
# AKSI
# =====================================

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
    """Bunyikan indikator gagal tanpa menimpa pesan spesifik dari backend."""
    suara_gagal_led()
    time.sleep(1.0)
    led_standby()


def tunggu_kartu_pergi(timeout_ms=2000):
    """Tunggu kartu diangkat agar satu tap tidak terbaca dua kali."""
    kosong = 0
    mulai = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), mulai) < timeout_ms:
        stat, _ = rfid.request(rfid.REQIDL)
        if stat != rfid.OK:
            kosong += 1
            if kosong >= 3:
                return
        else:
            kosong = 0
        time.sleep_ms(60)


# =====================================
# RFID SETUP (dengan percobaan ulang)
# SDA/CS=13, SCK=21, MOSI=12, MISO=22, RST=5
# =====================================

def init_rfid(percobaan=5):
    for i in range(percobaan):
        try:
            spi = SPI(2, baudrate=1000000, polarity=0, phase=0,
                      sck=Pin(21), mosi=Pin(12), miso=Pin(22))
            reader = MFRC522(spi, gpioRst=5, gpioCs=13)
            update_monitor_state(rfid_initialized=True, rfid_connected=True, error=None)
            return reader
        except Exception as e:
            print("RFID gagal init, coba lagi:", e)
            update_monitor_state(rfid_initialized=False, rfid_connected=False, error=str(e)[:500])
            time.sleep(0.5)
    raise OSError("RFID tidak terdeteksi")


# =====================================
# PROGRAM UTAMA
# =====================================

def jalankan():
    global rfid, wlan

    led_standby()
    layar_wifi("BOOT...", "CARI WIFI")
    time.sleep(0.4)

    # --- WiFi: pilih yang terkuat dari daftar tersimpan ---
    wlan = connect_best_wifi()
    if wlan:
        print("WiFi siap, IP:", wlan.ifconfig()[0])
        print("Backend RFID:", SERVER_URL)
        try:
            import ntptime
            ntptime.settime()
        except Exception as error:
            print("Sinkronisasi waktu NTP gagal:", error)
    else:
        print("Tidak terhubung WiFi, lanjut mode offline")

    start_monitoring()

    # --- RFID ---
    rfid = init_rfid()

    layar_splash()
    time.sleep(0.6)

    uid_terakhir = ""
    waktu_terakhir = 0
    perlu_gambar_idle = True

    while True:

        if perlu_gambar_idle:
            led_standby()
            layar_idle()
            perlu_gambar_idle = False

        stat, _ = rfid.request(rfid.REQIDL)

        if stat == rfid.OK:
            stat, uid = rfid.anticoll()

            if stat == rfid.OK:
                uid_string = "-".join("{:02X}".format(x) for x in uid)
                print("UID:", uid_string)
                update_monitor_state(
                    last_uid=uid_string,
                    last_read_at=utc_now_iso(),
                    rfid_initialized=True,
                    rfid_connected=True
                )

                sekarang = time.ticks_ms()
                if uid_string == uid_terakhir and \
                   time.ticks_diff(sekarang, waktu_terakhir) < DEBOUNCE_MS:
                    time.sleep_ms(50)
                    continue

                uid_terakhir = uid_string
                waktu_terakhir = sekarang

                print("  -> Mengirim UID ke backend...")
                hasil = kirim_uid_backend(uid_string)
                proses_respons_backend(hasil)

                tunggu_kartu_pergi()
                perlu_gambar_idle = True

        time.sleep_ms(50)


# =====================================
# START OTOMATIS (dijalankan saat daya masuk)
# =====================================

try:
    jalankan()
except Exception as e:
    print("ERROR:", e)
    led_mati()
    led_merah.value(1)
    try:
        layar_error()
    except Exception:
        pass
    time.sleep(2)
    reset()    # restart otomatis board
