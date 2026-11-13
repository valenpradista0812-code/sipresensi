const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = Number(process.env.IOT_DISCOVERY_PORT || 41234);
const DISCOVERY_MESSAGE = 'SIPRESENSI_DISCOVER';
const REPLY_PREFIX = 'SIPRESENSI_SERVER ';

function ipToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function sameSubnet(address, iface) {
  if (!iface.netmask) return false;
  const mask = ipToInt(iface.netmask);
  return (ipToInt(address) & mask) === (ipToInt(iface.address) & mask);
}

function resolveReplyAddress(sender) {
  let fallback = null;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const iface of addresses || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (sameSubnet(sender, iface)) return iface.address;
      if (!fallback) fallback = iface.address;
    }
  }
  return fallback;
}

function startDiscovery(httpPort, options = {}) {
  const udpPort = options.udpPort || DISCOVERY_PORT;
  const logger = options.logger || console;
  const socket = dgram.createSocket('udp4');

  socket.on('error', error => {
    logger.warn(`[discovery] UDP ${udpPort} tidak aktif: ${error.message}`);
    try { socket.close(); } catch {}
  });

  socket.on('message', (message, remote) => {
    if (message.toString().trim() !== DISCOVERY_MESSAGE) return;
    const address = resolveReplyAddress(remote.address);
    if (!address) return;
    const reply = Buffer.from(`${REPLY_PREFIX}http://${address}:${httpPort}`);
    socket.send(reply, remote.port, remote.address, error => {
      if (error) logger.warn(`[discovery] Gagal membalas ${remote.address}: ${error.message}`);
    });
  });

  socket.bind(udpPort, () => {
    try { socket.setBroadcast(true); } catch {}
    logger.log(`[discovery] Menunggu broadcast perangkat di UDP ${udpPort}`);
  });

  return socket;
}

module.exports = {
  startDiscovery,
  DISCOVERY_PORT,
  DISCOVERY_MESSAGE,
  REPLY_PREFIX
};
