const crypto = require('crypto');
const express = require('express');
const db = require('../data/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const DEVICE_ID = process.env.IOT_DEVICE_ID || 'rfid-main';
const HEARTBEAT_TIMEOUT_MS = 45_000;
const MAX_RSSI = 0;
const MIN_RSSI = -127;

function requireServiceRole(req, res, next) {
  if (!db.hasServiceRoleKey) {
    return res.status(503).json({
      success: false,
      message: 'Monitoring perangkat memerlukan SUPABASE_SERVICE_ROLE_KEY di environment backend.'
    });
  }
  return next();
}

function authenticateDevice(req, res, next) {
  const expected = process.env.IOT_DEVICE_TOKEN;
  const authorization = req.headers.authorization || '';
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!expected) {
    return res.status(503).json({ success: false, message: 'Autentikasi perangkat belum dikonfigurasi.' });
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return res.status(401).json({ success: false, message: 'Autentikasi perangkat tidak valid.' });
  }
  next();
}

function schemaUnavailable(error) {
  return ['42P01', 'PGRST204', 'PGRST205'].includes(error.code) ||
    /iot_devices|iot_device_events|iot_device_commands/i.test(error.message || '');
}

function sendError(res, error, fallback) {
  if (schemaUnavailable(error)) {
    return res.status(503).json({
      success: false,
      message: 'Skema monitoring belum tersedia. Tinjau dan terapkan 2026110801_iot_device_monitoring.sql.'
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: fallback });
}

function isFresh(timestamp, now = Date.now()) {
  const seen = Date.parse(timestamp || '');
  return Number.isFinite(seen) && now - seen <= HEARTBEAT_TIMEOUT_MS;
}

function boundedString(value, maxLength) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function validTimestamp(value) {
  if (typeof value !== 'string') return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

async function addEvent(eventType, details = {}) {
  return db.createIotDeviceEvent({
    device_id: DEVICE_ID,
    event_type: eventType,
    details
  });
}

async function getStatusSnapshot() {
  const device = await db.getIotDevice(DEVICE_ID);
  const now = new Date();
  const online = isFresh(device?.last_seen_at, now.getTime());

  if (device?.last_seen_at && !online && !device.offline_reported_at) {
    const markedOffline = await db.markIotDeviceOffline(DEVICE_ID, now.toISOString());
    if (markedOffline) {
      await addEvent('device_disconnected', { last_seen_at: device.last_seen_at });
      device.offline_reported_at = now.toISOString();
    }
  }

  await db.expireIotDeviceCommands(DEVICE_ID, now.toISOString());
  const activeCommand = await db.getActiveIotDeviceCommand(DEVICE_ID);
  return {
    device,
    online,
    activeCommand,
    lastSeenAgeSeconds: device?.last_seen_at
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(device.last_seen_at)) / 1000))
      : null
  };
}

router.post('/heartbeat', authenticateDevice, requireServiceRole, async (req, res) => {
  const body = req.body || {};
  const wifi = body.wifi || {};
  const rfid = body.rfid || {};
  if (body.device_id !== DEVICE_ID) {
    return res.status(400).json({ success: false, message: 'ID perangkat tidak dikenal.' });
  }
  if (typeof wifi.connected !== 'boolean' ||
      typeof rfid.initialized !== 'boolean' ||
      (rfid.connected !== null && rfid.connected !== undefined && typeof rfid.connected !== 'boolean')) {
    return res.status(400).json({ success: false, message: 'Payload status Wi-Fi atau RFID tidak valid.' });
  }
  if (wifi.rssi !== null && wifi.rssi !== undefined &&
      (!Number.isInteger(wifi.rssi) || wifi.rssi < MIN_RSSI || wifi.rssi > MAX_RSSI)) {
    return res.status(400).json({ success: false, message: 'Nilai RSSI tidak valid.' });
  }
  const cardReadAt = validTimestamp(rfid.last_read_at);
  const lastUid = boundedString(rfid.last_uid, 80);
  const rfidError = boundedString(rfid.error, 500);
  const deviceError = boundedString(body.error, 500);

  try {
    const now = new Date().toISOString();
    const previous = await db.getIotDevice(DEVICE_ID);
    const wasOnline = isFresh(previous?.last_seen_at);
    const wifiSsid = boundedString(wifi.ssid, 120);
    const ipAddress = boundedString(wifi.ip, 64);
    const firmwareVersion = boundedString(body.firmware_version, 80);
    const isNewCard = Boolean(lastUid &&
      (lastUid !== previous?.last_uid ||
        (cardReadAt && (!previous?.last_card_at ||
          Date.parse(cardReadAt) > Date.parse(previous.last_card_at)))));
    const recordedCardAt = cardReadAt || now;

    await db.upsertIotDevice({
      id: DEVICE_ID,
      name: boundedString(body.device_name, 120) || 'RFID SiPresensi',
      last_seen_at: now,
      offline_reported_at: null,
      wifi_connected: wifi.connected,
      wifi_ssid: wifiSsid,
      ip_address: ipAddress,
      rssi: wifi.rssi ?? null,
      rfid_initialized: rfid.initialized,
      rfid_connected: typeof rfid.connected === 'boolean' ? rfid.connected : null,
      last_uid: isNewCard ? lastUid : previous?.last_uid || null,
      last_card_at: isNewCard ? recordedCardAt : previous?.last_card_at || null,
      last_error: deviceError || rfidError,
      last_error_at: deviceError || rfidError
        ? (deviceError !== previous?.last_error && rfidError !== previous?.last_error
          ? now
          : previous?.last_error_at || now)
        : null,
      firmware_version: firmwareVersion
    });

    if (!wasOnline) await addEvent('device_connected', { ip_address: ipAddress });
    if (previous && (previous.wifi_connected !== wifi.connected ||
        previous.wifi_ssid !== wifiSsid || previous.ip_address !== ipAddress)) {
      await addEvent('wifi_changed', {
        previous_connected: previous.wifi_connected,
        wifi_connected: wifi.connected,
        previous_ssid: previous.wifi_ssid,
        wifi_ssid: wifiSsid,
        previous_ip: previous.ip_address,
        ip_address: ipAddress
      });
    }
    if (isNewCard) await addEvent('rfid_card_read', { uid: lastUid, read_at: recordedCardAt });
    if (rfidError && rfidError !== previous?.last_error) {
      await addEvent('rfid_error', { message: rfidError });
    }
    if (deviceError && deviceError !== previous?.last_error) {
      await addEvent('device_error', { message: deviceError });
    }

    const completedCommands = await db.completeAcknowledgedIotDeviceCommands(DEVICE_ID, now);
    if (completedCommands.length) {
      await db.updateIotDevice(DEVICE_ID, { last_restart_at: now });
      await addEvent('restarted', { command_ids: completedCommands.map(command => command.id) });
    }
    return res.json({ success: true, received_at: now });
  } catch (error) {
    return sendError(res, error, 'Gagal menyimpan heartbeat perangkat.');
  }
});

router.get('/commands', authenticateDevice, requireServiceRole, async (req, res) => {
  try {
    const now = new Date().toISOString();
    await db.expireIotDeviceCommands(DEVICE_ID, now);
    const data = await db.getIotDeviceCommands(DEVICE_ID, now);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Gagal memuat perintah perangkat.');
  }
});

router.post('/commands/:id/ack', authenticateDevice, requireServiceRole, async (req, res) => {
  const { status, error: commandError } = req.body || {};
  if (!['acknowledged', 'failed'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status konfirmasi perintah tidak valid.' });
  }
  if (commandError !== undefined && (typeof commandError !== 'string' || commandError.length > 500)) {
    return res.status(400).json({ success: false, message: 'Keterangan error maksimal 500 karakter.' });
  }

  try {
    const now = new Date().toISOString();
    const command = await db.updateIotDeviceCommand(req.params.id, DEVICE_ID, status, {
      acknowledged_at: now,
      error: status === 'failed' ? commandError || 'Perangkat gagal menjalankan perintah.' : null
    });
    if (!command) {
      return res.status(409).json({ success: false, message: 'Perintah tidak ditemukan, kedaluwarsa, atau sudah diproses.' });
    }
    if (status === 'acknowledged') {
      await addEvent('restart_acknowledged', { command_id: command.id });
    } else {
      await addEvent('device_error', { command_id: command.id, message: command.error });
    }
    return res.json({ success: true, data: command });
  } catch (error) {
    return sendError(res, error, 'Gagal mengonfirmasi perintah perangkat.');
  }
});

router.get('/status', authenticate, requireRole('guru', 'admin', 'petugas'), requireServiceRole, async (req, res) => {
  try {
    const snapshot = await getStatusSnapshot();
    return res.json({ success: true, data: snapshot });
  } catch (error) {
    return sendError(res, error, 'Gagal memuat status perangkat.');
  }
});

router.get('/events', authenticate, requireRole('guru', 'admin', 'petugas'), requireServiceRole, async (req, res) => {
  try {
    const data = await db.getIotDeviceEvents(DEVICE_ID, 100);
    return res.json({ success: true, count: data.length, data });
  } catch (error) {
    return sendError(res, error, 'Gagal memuat riwayat perangkat.');
  }
});

router.post('/restart', authenticate, requireRole('guru', 'admin', 'petugas'), requireServiceRole, async (req, res) => {
  try {
    const snapshot = await getStatusSnapshot();
    if (!snapshot.online) {
      return res.status(409).json({ success: false, message: 'Perangkat sedang offline; perintah restart tidak dikirim.' });
    }
    if (snapshot.activeCommand) {
      return res.status(409).json({ success: false, message: 'Masih ada perintah perangkat yang belum selesai.' });
    }

    const now = new Date();
    const command = await db.createIotDeviceCommand({
      id: `iotcmd-${crypto.randomUUID()}`,
      device_id: DEVICE_ID,
      command: 'restart',
      status: 'pending',
      requested_by: String(req.user.id).slice(0, 80),
      requested_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 60_000).toISOString()
    });
    await addEvent('restart_requested', { command_id: command.id, requested_by: command.requested_by });
    return res.status(202).json({
      success: true,
      message: 'Perintah restart masuk antrean. Perangkat akan restart setelah menerima dan mengonfirmasi perintah.',
      data: { id: command.id, status: command.status, expires_at: command.expires_at }
    });
  } catch (error) {
    return sendError(res, error, 'Gagal mengirim perintah restart.');
  }
});

module.exports = router;
