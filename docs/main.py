from machine import Pin, SPI, I2C, PWM, reset
import time
import gc
import ssd1306
import framebuf
import network
import json
import socket
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
DEBOUNCE_MS = 2000
LEBAR = 128
TINGGI = 32

WIFI_CONFIG_FILE = "wifi_config.json"
DEVICE_CONFIG_FILE = "device_config.json"
WIFI_CONNECT_TIMEOUT = 8

# =====================================
# KONFIGURASI BACKEND SIPRESENSI
# =====================================
# Alamat default. Bisa dioverride lewat device_config.json ("server_url")
# atau per-SSID di wifi_config.json ("server_url"), dan diperbarui otomatis
# lewat discovery UDP bila server berada di jaringan yang sama.
DEFAULT_SERVER_URL = "http://192.168.1.5:3000"
BACKEND_BASE_URL = DEFAULT_SERVER_URL
SERVER_URL = BACKEND_BASE_URL + "/api/iot/rfid"
MONITOR_BASE_URL = BACKEND_BASE_URL + "/api/iot-monitoring"
DISCOVERY_PORT = 41234
DISCOVERY_MESSAGE = b"SIPRESENSI_DISCOVER"
DISCOVERY_REPLY_PREFIX = "SIPRESENSI_SERVER "
FIRMWARE_VERSION = "2026.11.08"
HEARTBEAT_INTERVAL_MS = 15000
COMMAND_POLL_INTERVAL_MS = 5000
MONITOR_TIMEOUT_SECONDS = 2

# [FIX] Timeout + retry untuk stres test
RFID_HTTP_TIMEOUT_MS = 3000
RFID_HTTP_RETRY = 1
RFID_QUEUE_MAX = 2
MONITOR_HTTP_TIMEOUT_MS = 2500


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
configured_server = DEVICE_CONFIG.get("server_url")
if isinstance(configured_server, str) and configured_server.strip():
    DEFAULT_SERVER_URL = configured_server.strip().rstrip("/")
BACKEND_BASE_URL = DEFAULT_SERVER_URL
SERVER_URL = BACKEND_BASE_URL + "/api/iot/rfid"
MONITOR_BASE_URL = BACKEND_BASE_URL + "/api/iot-monitoring"
configured_discovery_port = DEVICE_CONFIG.get("discovery_port")
if isinstance(configured_discovery_port, int) and 0 < configured_discovery_port < 65536:
    DISCOVERY_PORT = configured_discovery_port

STATE_LOCK = _thread.allocate_lock() if _thread else None
HTTP_LOCK_RFID = _thread.allocate_lock() if _thread else None
HTTP_LOCK_MONITOR = _thread.allocate_lock() if _thread else None
_BUZZ_LOCK = _thread.allocate_lock() if _thread else None

monitor_state = {
    "rfid_initialized": False,
    "rfid_connected": None,
    "last_uid": None,
    "last_read_at": None,
    "error": None
}

# [FIX] Antrean 2 slot agar tap cepat tidak langsung ditolak
RFID_JOB_LOCK = _thread.allocate_lock() if _thread else None
rfid_job = {
    "queue": [],
    "result": None,
    "result_ready": False,
    "busy": False,
}

time.sleep(1)


# =====================================
# OLED SETUP (SDA=26, SCL=27)
# =====================================

i2c = I2C(0, scl=Pin(27), sda=Pin(26), freq=400000)
oled = ssd1306.SSD1306_I2C(LEBAR, TINGGI, i2c, 0x3C)

canvas = framebuf.FrameBuffer(bytearray(LEBAR * TINGGI // 8),
                              LEBAR, TINGGI, framebuf.MONO_VLSB)


def tampilkan():
    try:
        oled.buffer[:] = canvas.buffer[:]
        oled.show()
    except AttributeError:
        try:
            oled.blit(canvas, 0, 0)
            oled.show()
        except AttributeError:
            for y in range(TINGGI):
                for x in range(LEBAR):
                    oled.pixel(x, y, canvas.pixel(x, y))
            oled.show()


# =====================================
# HELPER TEKS
# =====================================

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


# =====================================
# ANIMASI (single-frame)
# =====================================

def anim_sukses(nama):
    gambar_sukses(nama)
    tampilkan()


def anim_gagal():
    gambar_gagal(0)
    tampilkan()


# =====================================
# LED
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
# BUZZER (GPIO 32 & 33)
# =====================================

buzzer1 = PWM(Pin(32))
buzzer2 = PWM(Pin(33))
buzzer1.duty(0)
buzzer2.duty(0)


def _bunyi_blocking(freq, durasi, volume):
    buzzer1.freq(freq)
    buzzer2.freq(freq)
    buzzer1.duty(volume)
    buzzer2.duty(volume)
    time.sleep(durasi)
    buzzer1.duty(0)
    buzzer2.duty(0)


def bunyi(freq, durasi, volume=400):
    if not SUARA_AKTIF:
        time.sleep(durasi)
        return
    _bunyi_blocking(freq, durasi, volume)


NADA_SUKSES = [(1760, 0.05), (2637, 0.07)]
NADA_GAGAL = [(196, 0.07), (147, 0.09)]


def _bunyi_async(notes, volume, led):
    if not SUARA_AKTIF:
        return
    if _thread is None or _BUZZ_LOCK is None:
        for freq, durasi in notes:
            led.value(1)
            _bunyi_blocking(freq, durasi, volume)
            led.value(0)
        return

    def _run():
        _BUZZ_LOCK.acquire()
        try:
            for freq, durasi in notes:
                led.value(1)
                _bunyi_blocking(freq, durasi, volume)
                led.value(0)
                time.sleep(0.02)
        finally:
            _BUZZ_LOCK.release()
    _thread.start_new_thread(_run, ())


def suara_sukses_led():
    _bunyi_async(NADA_SUKSES, 400, led_kuning)
    led_standby()


def suara_gagal_led():
    _bunyi_async(NADA_GAGAL, 512, led_merah)
    led_standby()


# =====================================
# [BARU] NOTIFIKASI BUZZER WIFI
# =====================================

def notif_wifi_connect_attempt():
    if not SUARA_AKTIF:
        return
    if _thread:
        try:
            _thread.start_new_thread(_bunyi_blocking, (1200, 0.05, 350))
            return
        except Exception:
            pass
    _bunyi_blocking(1200, 0.05, 350)


def notif_wifi_terhubung():
    if not SUARA_AKTIF:
        return
    notes = [(1760, 0.06), (2093, 0.06), (2637, 0.10)]
    if _thread is None or _BUZZ_LOCK is None:
        for freq, durasi in notes:
            _bunyi_blocking(freq, durasi, 400)
            time.sleep(0.03)
        return

    def _run():
        _BUZZ_LOCK.acquire()
        try:
            for freq, durasi in notes:
                _bunyi_blocking(freq, durasi, 400)
                time.sleep(0.03)
        finally:
            _BUZZ_LOCK.release()
    _thread.start_new_thread(_run, ())


def notif_wifi_gagal():
    if not SUARA_AKTIF:
        return
    notes = [(196, 0.10), (147, 0.14)]
    if _thread is None or _BUZZ_LOCK is None:
        for freq, durasi in notes:
            _bunyi_blocking(freq, durasi, 512)
            time.sleep(0.03)
        return

    def _run():
        _BUZZ_LOCK.acquire()
        try:
            for freq, durasi in notes:
                _bunyi_blocking(freq, durasi, 512)
                time.sleep(0.03)
        finally:
            _BUZZ_LOCK.release()
    _thread.start_new_thread(_run, ())


# =====================================
# MANAJEMEN WIFI
# =====================================

def set_backend_base(url):
    """Ganti alamat backend saat runtime (konfigurasi per-SSID/hasil discovery)."""
    global BACKEND_BASE_URL, SERVER_URL, MONITOR_BASE_URL
    if not isinstance(url, str):
        return False
    url = url.strip().rstrip("/")
    if not (url.startswith("http://") or url.startswith("https://")):
        return False
    BACKEND_BASE_URL = url
    SERVER_URL = url + "/api/iot/rfid"
    MONITOR_BASE_URL = url + "/api/iot-monitoring"
    return True


def discover_backend(timeout=2):
    """Cari alamat server Express di jaringan aktif lewat UDP broadcast."""
    if not wlan or not wlan.isconnected():
        return None
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(timeout)
        targets = ["255.255.255.255"]
        try:
            ip_address, netmask = wlan.ifconfig()[0], wlan.ifconfig()[1]
            ip_parts = [int(part) for part in ip_address.split(".")]
            mask_parts = [int(part) for part in netmask.split(".")]
            directed = ".".join(str(ip_parts[i] | (255 - mask_parts[i])) for i in range(4))
            if directed not in targets:
                targets.append(directed)
        except Exception:
            pass
        for target in targets:
            try:
                sock.sendto(DISCOVERY_MESSAGE, (target, DISCOVERY_PORT))
            except Exception as error:
                print("Kirim discovery ke {} gagal: {}".format(target, error))
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                data, _ = sock.recvfrom(128)
            except OSError:
                break
            text = data.decode("utf-8", "ignore").strip()
            if text.startswith(DISCOVERY_REPLY_PREFIX):
                url = text[len(DISCOVERY_REPLY_PREFIX):].strip()
                if set_backend_base(url):
                    print("Backend ditemukan via discovery:", url)
                    return url
    except Exception as error:
        print("Discovery backend gagal:", error)
    finally:
        try:
            sock.close()
        except Exception:
            pass
    return None


def load_wifi_list():
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
    saved = load_wifi_list()
    if not saved:
        print("Tidak ada WiFi tersimpan")
        layar_wifi("WIFI KOSONG", "MODE OFFLINE")
        notif_wifi_gagal()
        time.sleep(1.5)
        return None

    saved_map = {}
    for item in saved:
        if isinstance(item, dict) and item.get("ssid"):
            saved_map[item["ssid"]] = item

    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    layar_wifi("SCAN WIFI...", "")
    print("Memindai jaringan sekitar...")
    try:
        nets = wlan.scan()
    except Exception as e:
        print("Pemindaian gagal:", e)
        layar_wifi("SCAN GAGAL", "MODE OFFLINE")
        notif_wifi_gagal()
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
        notif_wifi_gagal()
        time.sleep(1.5)
        return None

    candidates.sort(key=lambda x: x[1], reverse=True)
    print("Kandidat WiFi (urut RSSI):")
    for ssid, rssi, _ in candidates:
        print("  {}  RSSI={}".format(ssid, rssi))

    for ssid, rssi, entry in candidates:
        print("Mencoba {} (RSSI={})...".format(ssid, rssi))
        layar_wifi("KONEK KE", ssid[:16])
        notif_wifi_connect_attempt()

        try:
            wlan.disconnect()
        except Exception:
            pass
        time.sleep(0.3)

        try:
            wlan.connect(ssid, entry.get("password", ""))
        except Exception as e:
            print("  Panggilan connect error:", e)
            continue

        start = time.time()
        while not wlan.isconnected() and (time.time() - start) < WIFI_CONNECT_TIMEOUT:
            time.sleep(0.3)

        if wlan.isconnected():
            ip = wlan.ifconfig()[0]
            print("  Terhubung, IP:", ip)
            server_url = entry.get("server_url")
            if isinstance(server_url, str) and server_url.strip():
                set_backend_base(server_url)
                print("  Backend untuk {}: {}".format(ssid, BACKEND_BASE_URL))
            layar_wifi("WIFI OK", ip)
            notif_wifi_terhubung()
            time.sleep(1.0)
            return wlan
        else:
            print("  Timeout, coba berikutnya")

    print("Semua jaringan tersimpan gagal")
    layar_wifi("WIFI GAGAL", "MODE OFFLINE")
    notif_wifi_gagal()
    time.sleep(1.5)
    return None


# =====================================
# KOMUNIKASI BACKEND
# =====================================

def _http_post_rfid(payload, headers, timeout_s):
    """Satu percobaan POST. Return (status, data) atau None kalau error network."""
    response = None
    try:
        response = urequests.post(
            SERVER_URL,
            data=json.dumps(payload),
            headers=headers,
            timeout=timeout_s
        )
        status = response.status_code
        try:
            raw = response.content
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            data = json.loads(raw) if raw.strip() else {}
        except Exception:
            data = {}
        if 200 <= status < 300 and not data:
            data = {"success": True, "_no_body": True}
        return status, data
    except OSError as e:
        print("HTTP error (akan retry):", e)
        return None
    except Exception as e:
        print("HTTP error non-retry:", e)
        return None
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
        try:
            gc.collect()
        except Exception:
            pass


def kirim_uid_backend(uid_string):
    if not wlan or not wlan.isconnected():
        print("Backend tidak dapat dihubungi: WiFi terputus")
        return None

    if not DEVICE_TOKEN or DEVICE_TOKEN == "GANTI_DENGAN_IOT_DEVICE_TOKEN":
        print("DEVICE_TOKEN belum dikonfigurasi")
        return None

    # [FIX] event_id SAMA untuk semua retry -> idempotent di server
    event_id = "esp32-{}-{}-{}".format(
        uid_string.replace("-", ""),
        time.ticks_ms(),
        urandom.getrandbits(16)
    )
    payload = {"uid": uid_string, "event_id": event_id}
    headers = {
        "Authorization": "Bearer " + DEVICE_TOKEN,
        "Content-Type": "application/json",
        "Connection": "close",
    }

    if HTTP_LOCK_RFID:
        HTTP_LOCK_RFID.acquire()
    try:
        timeout_s = max(1, RFID_HTTP_TIMEOUT_MS // 1000)
        attempts = 1 + RFID_HTTP_RETRY

        for attempt in range(attempts):
            t0 = time.ticks_ms()
            result = _http_post_rfid(payload, headers, timeout_s)
            elapsed = time.ticks_diff(time.ticks_ms(), t0)

            if result is not None:
                status, data = result
                print("RFID HTTP {} dalam {}ms (percobaan ke-{})".format(
                    status, elapsed, attempt + 1))
                return status, data

            print("Percobaan ke-{} gagal ({}ms), retry...".format(
                attempt + 1, elapsed))

            if attempt < attempts - 1:
                time.sleep_ms(200)

        print("RFID gagal total setelah {} percobaan".format(attempts))
        return None

    finally:
        if HTTP_LOCK_RFID:
            HTTP_LOCK_RFID.release()


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
    if HTTP_LOCK_MONITOR:
        HTTP_LOCK_MONITOR.acquire()
    try:
        response = urequests.post(
            MONITOR_BASE_URL + "/heartbeat",
            data=json.dumps(payload),
            headers={
                "Authorization": "Bearer " + DEVICE_TOKEN,
                "Content-Type": "application/json",
                "Connection": "close",
            },
            timeout=MONITOR_HTTP_TIMEOUT_MS // 1000
        )
        if response.status_code < 200 or response.status_code >= 300:
            raise OSError("Heartbeat HTTP {}".format(response.status_code))
        print("Heartbeat perangkat terkirim")
    except Exception as error:
        print("Gagal mengirim heartbeat:", error)
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
            response = None
        if discover_backend():
            try:
                response = urequests.post(
                    MONITOR_BASE_URL + "/heartbeat",
                    data=json.dumps(payload),
                    headers={
                        "Authorization": "Bearer " + DEVICE_TOKEN,
                        "Content-Type": "application/json",
                        "Connection": "close",
                    },
                    timeout=MONITOR_HTTP_TIMEOUT_MS // 1000
                )
                if response.status_code < 200 or response.status_code >= 300:
                    raise OSError("Heartbeat HTTP {}".format(response.status_code))
                print("Heartbeat perangkat terkirim setelah discovery")
            except Exception as retry_error:
                print("Gagal mengirim heartbeat setelah discovery:", retry_error)
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
        if HTTP_LOCK_MONITOR:
            HTTP_LOCK_MONITOR.release()


def acknowledge_restart(command_id):
    response = None
    if HTTP_LOCK_MONITOR:
        HTTP_LOCK_MONITOR.acquire()
    try:
        response = urequests.post(
            MONITOR_BASE_URL + "/commands/{}/ack".format(command_id),
            data=json.dumps({"status": "acknowledged"}),
            headers={
                "Authorization": "Bearer " + DEVICE_TOKEN,
                "Content-Type": "application/json",
                "Connection": "close",
            },
            timeout=MONITOR_HTTP_TIMEOUT_MS // 1000
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
        if HTTP_LOCK_MONITOR:
            HTTP_LOCK_MONITOR.release()


def poll_device_commands():
    if not DEVICE_TOKEN or not wlan or not wlan.isconnected():
        return

    response = None
    if HTTP_LOCK_MONITOR:
        HTTP_LOCK_MONITOR.acquire()
    try:
        response = urequests.get(
            MONITOR_BASE_URL + "/commands",
            headers={
                "Authorization": "Bearer " + DEVICE_TOKEN,
                "Connection": "close",
            },
            timeout=MONITOR_HTTP_TIMEOUT_MS // 1000
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
        if HTTP_LOCK_MONITOR:
            HTTP_LOCK_MONITOR.release()

    for command in commands:
        if isinstance(command, dict) and command.get("command") == "restart" and command.get("id"):
            print("Menerima perintah restart dari backend")
            if acknowledge_restart(command.get("id")):
                time.sleep_ms(100)
                reset()


def submit_rfid_job(uid_string):
    if not _thread or not RFID_JOB_LOCK:
        return False
    RFID_JOB_LOCK.acquire()
    try:
        if len(rfid_job["queue"]) >= RFID_QUEUE_MAX:
            return False
        if uid_string in rfid_job["queue"]:
            return True
        rfid_job["queue"].append(uid_string)
        return True
    finally:
        RFID_JOB_LOCK.release()


def get_rfid_result():
    if not RFID_JOB_LOCK:
        return None
    RFID_JOB_LOCK.acquire()
    try:
        if not rfid_job["result_ready"]:
            return None
        result = rfid_job["result"]
        rfid_job["result"] = None
        rfid_job["result_ready"] = False
        return (True, result)
    finally:
        RFID_JOB_LOCK.release()


def rfid_http_worker():
    while True:
        uid_to_send = None
        RFID_JOB_LOCK.acquire()
        try:
            if rfid_job["queue"] and not rfid_job["busy"]:
                uid_to_send = rfid_job["queue"].pop(0)
                rfid_job["busy"] = True
        finally:
            RFID_JOB_LOCK.release()

        if uid_to_send is not None:
            print("Mengirim UID ke backend:", uid_to_send)
            result = kirim_uid_backend(uid_to_send)
            RFID_JOB_LOCK.acquire()
            try:
                rfid_job["result"] = result
                rfid_job["result_ready"] = True
                rfid_job["busy"] = False
            finally:
                RFID_JOB_LOCK.release()
        time.sleep_ms(10)


def start_rfid_worker():
    if not _thread or not RFID_JOB_LOCK:
        print("Thread RFID tidak tersedia; pengiriman async nonaktif")
        return False
    try:
        _thread.start_new_thread(rfid_http_worker, ())
        print("Worker HTTP RFID aktif")
        return True
    except Exception as error:
        print("Gagal menjalankan worker RFID:", error)
        return False


def monitoring_worker():
    last_heartbeat = None
    last_command_check = None
    while True:
        now = time.ticks_ms()
        if wlan and wlan.isconnected() and DEVICE_TOKEN:
            if last_heartbeat is None or time.ticks_diff(now, last_heartbeat) >= HEARTBEAT_INTERVAL_MS:
                last_heartbeat = now
                send_device_heartbeat()
                time.sleep_ms(200)
                continue
            if last_command_check is None or time.ticks_diff(now, last_command_check) >= COMMAND_POLL_INTERVAL_MS:
                last_command_check = now
                poll_device_commands()
        time.sleep_ms(300)


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
    pesan = data.get("message", "Permintaan gagal diproses")
    mode = data.get("mode")

    print("PESAN:", pesan)

    if not berhasil:
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
            tampilkan_pesan("SUDAH ABSEN", "HARI INI")
        elif status == 425:
            tampilkan_pesan("BELUM", "WAKTUNYA")
        else:
            tampilkan_pesan("GAGAL DIPROSES", "COBA LAGI")
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
        if data.get("trackerStarted") is True:
            if data.get("attendanceStatus") == "terlambat":
                tampilkan_pesan("TERLAMBAT", nama)
            else:
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
    suara_sukses_led()
    led_standby()


def aksi_gagal():
    suara_gagal_led()
    led_standby()


def aksi_error():
    suara_gagal_led()
    led_standby()


def tunggu_kartu_pergi(timeout_ms=2000):
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
# RFID SETUP
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

    wlan = connect_best_wifi()
    if wlan:
        print("WiFi siap, IP:", wlan.ifconfig()[0])
        if not discover_backend():
            print("Discovery tidak menemukan server; memakai", BACKEND_BASE_URL)
        print("Backend RFID:", SERVER_URL)
        try:
            import ntptime
            ntptime.settime()
        except Exception as error:
            print("Sinkronisasi waktu NTP gagal:", error)
    else:
        print("Tidak terhubung WiFi, lanjut mode offline")

    start_monitoring()

    rfid = init_rfid()

    layar_splash()
    time.sleep(0.6)

    uid_terakhir = ""
    waktu_terakhir = 0
    kartu_sudah_diproses = False
    kartu_kosong_count = 0
    worker_aktif = start_rfid_worker()
    perlu_gambar_idle = True

    while True:
        if worker_aktif:
            hasil = get_rfid_result()
            if hasil is not None:
                proses_respons_backend(hasil[1])
                perlu_gambar_idle = True

        if perlu_gambar_idle and not kartu_sudah_diproses:
            led_standby()
            layar_idle()
            perlu_gambar_idle = False

        stat, _ = rfid.request(rfid.REQIDL)

        if stat == rfid.OK:
            kartu_kosong_count = 0
            stat, uid = rfid.anticoll()
            if stat == rfid.OK:
                uid_string = "-".join("{:02X}".format(x) for x in uid)
                sekarang = time.ticks_ms()

                if not kartu_sudah_diproses:
                    kartu_sudah_diproses = True

                    update_monitor_state(
                        last_uid=uid_string,
                        last_read_at=utc_now_iso(),
                        rfid_initialized=True,
                        rfid_connected=True
                    )

                    if uid_string == uid_terakhir and \
                       time.ticks_diff(sekarang, waktu_terakhir) < DEBOUNCE_MS:
                        pass
                    else:
                        uid_terakhir = uid_string
                        waktu_terakhir = sekarang

                        if SUARA_AKTIF and _thread:
                            try:
                                _thread.start_new_thread(
                                    _bunyi_blocking, (2000, 0.03, 300)
                                )
                            except Exception:
                                pass
                        tampilkan_pesan("KARTU TERBACA", "MEMPROSES...")

                        if worker_aktif:
                            if not submit_rfid_job(uid_string):
                                tampilkan_pesan("ANTREAN PENUH", "TUNGGU")
                        else:
                            hasil = kirim_uid_backend(uid_string)
                            proses_respons_backend(hasil)
                            perlu_gambar_idle = True
        else:
            kartu_kosong_count += 1
            if kartu_kosong_count >= 2:
                kartu_sudah_diproses = False
                kartu_kosong_count = 2

        time.sleep_ms(5)


# =====================================
# START OTOMATIS
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
    reset()
