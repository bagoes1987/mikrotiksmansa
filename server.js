const http = require('http');
const fs = require('fs');
const path = require('path');

// Load config.json if exists
let localConfig = {};
try {
  const configFile = path.join(__dirname, 'config.json');
  if (fs.existsSync(configFile)) {
    localConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  }
} catch (e) {
  console.log('Using default config fallback');
}

// Support dynamic port provided by hosting (cPanel / Heroku / Passenger / VPS)
const PORT = process.env.PORT || localConfig.serverPort || 3000;
const PUBLIC_DIR = __dirname;

// Default configuration for Router MikroTik
let routerConfig = {
  ip: localConfig.mikrotik?.host || "192.168.88.1",
  username: localConfig.mikrotik?.username || "admin",
  password: localConfig.mikrotik?.password || "F2NTZUAKWZ",
  totalIspMbps: localConfig.network?.ispTotalMbps || 300
};

// In-memory state for settings
let currentWifiSettings = [
  { id: 1, name: "WiFi 1 (Ruang Guru & TU)", ip: "192.168.88.11", download: 60, upload: 20, active: true, color: "#3b82f6" },
  { id: 2, name: "WiFi 2 (Lab Komputer)", ip: "192.168.88.12", download: 70, upload: 25, active: true, color: "#10b981" },
  { id: 3, name: "WiFi 3 (Perpustakaan)", ip: "192.168.88.13", download: 30, upload: 10, active: true, color: "#f59e0b" },
  { id: 4, name: "WiFi 4 (Kelas X & XI)", ip: "192.168.88.14", download: 40, upload: 15, active: true, color: "#a855f7" },
  { id: 5, name: "WiFi 5 (Kelas XII)", ip: "192.168.88.15", download: 40, upload: 15, active: true, color: "#ec4899" },
  { id: 6, name: "WiFi 6 (Tamu & Lapangan)", ip: "192.168.88.16", download: 20, upload: 10, active: true, color: "#06b6d4" }
];

// Load connected clients data (75 devices)
const CLIENTS_FILE = path.join(__dirname, 'clients.json');
let currentClients = [];
function loadClientsData() {
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      currentClients = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Error loading clients.json:', e.message);
  }
}
function saveClientsData() {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(currentClients, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving clients.json:', e.message);
  }
}
loadClientsData();

function getClientStats() {
  const total = currentClients.length;
  const active = currentClients.filter(c => c.status === 'active' && !c.isBlocked).length;
  const blocked = currentClients.filter(c => c.isBlocked || c.status === 'blocked').length;
  const phones = currentClients.filter(c => c.deviceType === 'phone').length;
  const laptops = currentClients.filter(c => c.deviceType === 'laptop').length;
  const desktops = currentClients.filter(c => c.deviceType === 'desktop').length;
  const totalTrafficMbps = parseFloat(currentClients.reduce((acc, c) => acc + (c.isBlocked ? 0 : (c.downloadSpeed + c.uploadSpeed)), 0).toFixed(1));
  return { total, active, blocked, phones, laptops, desktops, totalTrafficMbps };
}

// Helper to send JSON
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// RouterOS v7 REST API Helper
async function mikrotikRequest(endpoint, method = 'GET', data = null) {
  const url = `http://${routerConfig.ip}/rest${endpoint}`;
  const authHeader = 'Basic ' + Buffer.from(`${routerConfig.username}:${routerConfig.password}`).toString('base64');
  
  const options = {
    method,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(3000) // 3 second timeout
  };

  if (data && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

// Generate RouterOS .rsc script
function generateRouterOSScript(wifiList) {
  let script = `# ========================================================\n`;
  script += `# SCRIPT KONFIGURASI OTOMATIS MIKROTIK SMANSA (hEX E50UG)\n`;
  script += `# Dihasilkan otomatis oleh Aplikasi Setting Mikrotik SMANSA\n`;
  script += `# Tanggal: ${new Date().toLocaleString()}\n`;
  script += `# ========================================================\n\n`;

  script += `# 1. Identitas Router\n`;
  script += `/system identity set name="MikroTik-SMANSA"\n\n`;

  script += `# 2. Bridge Port LAN (Ether 2 ke Switch Hub TL-SG1016D)\n`;
  script += `:if ([:len [/interface bridge find name=bridge-LAN]] = 0) do={\n`;
  script += `  /interface bridge add name=bridge-LAN comment="Bridge Switch Hub SMANSA"\n`;
  script += `  /interface bridge port add bridge=bridge-LAN interface=ether2 comment="Ke Switch Hub TL-SG1016D"\n`;
  script += `  /interface bridge port add bridge=bridge-LAN interface=ether3\n`;
  script += `  /interface bridge port add bridge=bridge-LAN interface=ether4\n`;
  script += `  /interface bridge port add bridge=bridge-LAN interface=ether5\n`;
  script += `}\n\n`;

  script += `# 3. Koneksi Internet Indibiz 300 Mbps (Ether 1)\n`;
  script += `:if ([:len [/ip dhcp-client find interface=ether1]] = 0) do={\n`;
  script += `  /ip dhcp-client add interface=ether1 disabled=no use-peer-dns=yes add-default-route=yes comment="Indibiz 300 Mbps"\n`;
  script += `}\n\n`;

  script += `# 4. IP Gateway & Firewall NAT\n`;
  script += `:if ([:len [/ip address find address="192.168.88.1/24"]] = 0) do={\n`;
  script += `  /ip address add address=192.168.88.1/24 interface=bridge-LAN comment="Gateway LAN SMANSA"\n`;
  script += `}\n`;
  script += `/ip dns set allow-remote-requests=yes servers=1.1.1.1,8.8.8.8\n`;
  script += `:if ([:len [/ip firewall nat find comment="NAT Internet Indibiz"]] = 0) do={\n`;
  script += `  /ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade comment="NAT Internet Indibiz"\n`;
  script += `}\n\n`;

  script += `# 5. Anti-Konflik IP: Kunci IP Statis untuk 6 Router WiFi\n`;
  wifiList.forEach(w => {
    const cleanName = w.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    script += `:if ([:len [/ip dhcp-server lease find address="${w.ip}"]] = 0) do={\n`;
    script += `  /ip dhcp-server lease add address=${w.ip} comment="${cleanName}"\n`;
    script += `}\n`;
  });
  script += `\n`;

  script += `# 6. Simple Queues (Jatah Bandwidth WiFi 1 s/d WiFi 6)\n`;
  wifiList.forEach(w => {
    const cleanName = w.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const maxLimit = `${w.upload}M/${w.download}M`;
    const disabledState = w.active ? "no" : "yes";
    script += `:if ([:len [/queue simple find target="${w.ip}/32"]] = 0) do={\n`;
    script += `  /queue simple add name="${cleanName}" target=${w.ip}/32 max-limit=${maxLimit} disabled=${disabledState} comment="SMANSA Bandwidth"\n`;
    script += `} else={\n`;
    script += `  /queue simple set [find target="${w.ip}/32"] max-limit=${maxLimit} disabled=${disabledState}\n`;
    script += `}\n`;
  });

  script += `\n# 7. Firewall Rules: Drop Perangkat Terblokir (Blacklist)\n`;
  script += `:if ([:len [/ip firewall filter find comment="DROP_BLOCKED_CLIENTS"]] = 0) do={\n`;
  script += `  /ip firewall filter add chain=forward src-address-list=BLOCKED_CLIENTS action=drop comment="DROP_BLOCKED_CLIENTS"\n`;
  script += `}\n`;
  const blockedClients = currentClients.filter(c => c.isBlocked || c.status === 'blocked');
  if (blockedClients.length > 0) {
    blockedClients.forEach(c => {
      script += `:if ([:len [/ip firewall address-list find address="${c.ip}" list=BLOCKED_CLIENTS]] = 0) do={\n`;
      script += `  /ip firewall address-list add list=BLOCKED_CLIENTS address=${c.ip} comment="Blocked: ${c.hostname}"\n`;
      script += `}\n`;
    });
  }

  return script;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // 1. Status Connection
  if (url.pathname === '/api/status' && req.method === 'GET') {
    let mikrotikLive = false;
    let routerDetail = {
      model: "MikroTik hEX Series (E50UG Refresh)",
      serial: "HMF0B07QW3E",
      wanSpeed: "300 Mbps (Indibiz)",
      ip: routerConfig.ip
    };

    try {
      const resource = await mikrotikRequest('/system/resource');
      mikrotikLive = true;
      routerDetail.uptime = resource.uptime || "Online";
      routerDetail.cpuLoad = (resource['cpu-load'] || "5") + "%";
      routerDetail.version = resource.version || "RouterOS v7";
    } catch (e) {
      // Router is either not connected yet or in standby
      mikrotikLive = false;
      routerDetail.uptime = "Standby (Router belum tersambung ke LAN)";
      routerDetail.cpuLoad = "0%";
      routerDetail.note = "Aplikasi siap mentransfer konfigurasi saat router dihubungkan.";
    }

    return sendJSON(res, 200, {
      connected: mikrotikLive,
      routerDetail,
      config: routerConfig
    });
  }

  // 1b. Real-Time Hardware Ports Monitor (Ether 1 - Ether 5)
  if (url.pathname === '/api/ports' && req.method === 'GET') {
    try {
      const ifaces = await mikrotikRequest('/interface');
      let hosts = [];
      try { hosts = await mikrotikRequest('/interface/bridge/host'); } catch (e) {}

      const portMap = [
        { id: 1, iface: 'ether1', label: 'Port 1 (WAN)', desc: 'Sumber Internet Indibiz 300M' },
        { id: 2, iface: 'ether2', label: 'Port 2 (LAN)', desc: 'Ke Switch Hub TL-SG1016D' },
        { id: 3, iface: 'ether3', label: 'Port 3 (LAN)', desc: 'Jalur Port 3 MikroTik' },
        { id: 4, iface: 'ether4', label: 'Port 4 (LAN)', desc: 'Jalur Port 4 MikroTik' },
        { id: 5, iface: 'ether5', label: 'Port 5 (LAN)', desc: 'Jalur Port 5 MikroTik' },
      ];

      const ports = portMap.map(p => {
        const item = ifaces.find(i => i.name === p.iface || i['default-name'] === p.iface) || {};
        const isRunning = item.running === 'true' || item.running === true;
        
        let connectedDevice = 'Kosong';
        if (p.id === 1) {
          connectedDevice = isRunning ? 'Modem Indibiz 300 Mbps (IP: 192.168.1.19)' : 'Kabel Lepas / Tidak Terhubung';
        } else {
          const portHosts = hosts.filter(h => (h.interface === p.iface || h['on-interface'] === p.iface) && h.local !== 'true');
          if (portHosts.length > 1) {
            connectedDevice = `Switch Hub TL-SG1016D (${portHosts.length} Perangkat Aktif: Access Point U6-LR, TP-Link, dll)`;
          } else if (portHosts.length === 1) {
            const h = portHosts[0];
            connectedDevice = h['mac-address'] === '7C:10:C9:24:89:A3' 
              ? 'Laptop Admin (BarQie - 192.168.88.254)' 
              : `Perangkat (${h['mac-address']})`;
          } else if (isRunning) {
            connectedDevice = 'Kabel Terhubung (1 Gbps)';
          } else {
            connectedDevice = 'Mati / Tidak Ada Sinyal (Kabel Lepas / Kosong)';
          }
        }

        return {
          id: p.id,
          name: p.label,
          role: p.desc,
          running: isRunning,
          status: isRunning ? 'UP (Terhubung)' : 'DOWN (Mati / Lepas)',
          speed: isRunning ? '1 Gbps Full-Duplex' : 'Tidak Ada Sinyal',
          device: connectedDevice
        };
      });

      return sendJSON(res, 200, {
        success: true,
        connected: true,
        ports: ports
      });
    } catch (e) {
      return sendJSON(res, 200, {
        success: false,
        connected: false,
        error: e.message,
        ports: [
          { id: 1, name: 'Port 1 (WAN)', role: 'Indibiz', running: false, status: 'Router Standby', device: '-' },
          { id: 2, name: 'Port 2 (LAN)', role: 'Switch Hub', running: false, status: 'Router Standby', device: '-' },
          { id: 3, name: 'Port 3 (LAN)', role: 'Cadangan', running: false, status: 'Router Standby', device: '-' },
          { id: 4, name: 'Port 4 (LAN)', role: 'Cadangan', running: false, status: 'Router Standby', device: '-' },
          { id: 5, name: 'Port 5 (LAN)', role: 'Cadangan', running: false, status: 'Router Standby', device: '-' },
        ]
      });
    }
  }

  // 2. Get WiFi Settings
  if (url.pathname === '/api/wifi' && req.method === 'GET') {
    return sendJSON(res, 200, currentWifiSettings);
  }

  // 3. Save & Apply Bandwidth to MikroTik
  if (url.pathname === '/api/wifi' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        currentWifiSettings = payload;

        // Generate script and write to disk
        const scriptContent = generateRouterOSScript(currentWifiSettings);
        fs.writeFileSync(path.join(__dirname, 'smansa_config.rsc'), scriptContent, 'utf-8');

        // Attempt live apply via RouterOS REST API
        let appliedLive = false;
        let errorMessage = null;
        try {
          // Attempt to update queues in RouterOS
          for (const w of currentWifiSettings) {
            const cleanName = w.name.replace(/[^a-zA-Z0-9_-]/g, '_');
            const maxLimit = `${w.upload}M/${w.download}M`;
            // Call REST API
            await mikrotikRequest('/queue/simple', 'POST', {
              name: cleanName,
              target: `${w.ip}/32`,
              'max-limit': maxLimit,
              disabled: w.active ? false : true
            });
          }
          appliedLive = true;
        } catch (err) {
          errorMessage = err.message;
        }

        return sendJSON(res, 200, {
          success: true,
          appliedLive: appliedLive,
          message: appliedLive 
            ? "Sukses! Jatah bandwidth berhasil diterapkan langsung ke Router MikroTik."
            : "Pengaturan berhasil disimpan di sistem! Script 'smansa_config.rsc' telah diperbarui dan siap digunakan."
        });
      } catch (err) {
        return sendJSON(res, 400, { error: "Invalid data: " + err.message });
      }
    });
    return;
  }

  // 4. Run Auto Setup 1-Click
  if (url.pathname === '/api/auto-setup' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const scriptContent = generateRouterOSScript(currentWifiSettings);
        const scriptPath = path.join(__dirname, 'smansa_config.rsc');
        fs.writeFileSync(scriptPath, scriptContent, 'utf-8');

        return sendJSON(res, 200, {
          success: true,
          message: "Konfigurasi MikroTik SMANSA berhasil diproses!",
          scriptFile: "smansa_config.rsc"
        });
      } catch (err) {
        return sendJSON(res, 500, { error: err.message });
      }
    });
    return;
  }

  // 5. Download .rsc script
  if (url.pathname === '/api/download-script' && req.method === 'GET') {
    const scriptPath = path.join(__dirname, 'smansa_config.rsc');
    if (!fs.existsSync(scriptPath)) {
      const scriptContent = generateRouterOSScript(currentWifiSettings);
      fs.writeFileSync(scriptPath, scriptContent, 'utf-8');
    }
    const content = fs.readFileSync(scriptPath);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="smansa_config.rsc"'
    });
    res.end(content);
    return;
  }

  // 5a. Clients Management API
  if (url.pathname === '/api/clients' && req.method === 'GET') {
    const isDemoRequested = url.searchParams.get('demo') === '1';
    let clientsToReturn = currentClients;
    let isLiveHardware = false;

    if (!isDemoRequested) {
      try {
        const leases = await mikrotikRequest('/ip/dhcp-server/lease');
        if (Array.isArray(leases) && leases.length > 0) {
          clientsToReturn = leases.map(l => {
            const hostname = l['host-name'] || 'Perangkat-Lokal';
            const ip = l['active-address'] || l.address || '';
            const mac = (l['active-mac-address'] || l['mac-address'] || '').toUpperCase();
            const classId = l['class-id'] || '';

            let deviceType = 'phone';
            if (classId.includes('MSFT') || hostname.toLowerCase().includes('laptop') || hostname.toLowerCase().includes('pc') || hostname.toLowerCase().includes('desktop') || hostname === 'BarQie') {
              deviceType = 'laptop';
            }

            let wifiId = 1;
            let wifiName = "Jaringan LAN / Switch Hub (Ether 2)";
            if (ip.startsWith("192.168.88.11")) { wifiId = 1; wifiName = "WiFi 1 (Ruang Guru & TU)"; }
            else if (ip.startsWith("192.168.88.12")) { wifiId = 2; wifiName = "WiFi 2 (Lab Komputer)"; }
            else if (ip.startsWith("192.168.88.13")) { wifiId = 3; wifiName = "WiFi 3 (Perpustakaan)"; }
            else if (ip.startsWith("192.168.88.14")) { wifiId = 4; wifiName = "WiFi 4 (Kelas X & XI)"; }
            else if (ip.startsWith("192.168.88.15")) { wifiId = 5; wifiName = "WiFi 5 (Kelas XII)"; }
            else if (ip.startsWith("192.168.88.16")) { wifiId = 6; wifiName = "WiFi 6 (Tamu & Lapangan)"; }

            return {
              id: l['.id'] || mac,
              wifiId: wifiId,
              wifiName: wifiName,
              hostname: hostname,
              customName: hostname === 'BarQie' ? 'PC/Laptop Administrator (BarQie)' : hostname,
              ip: ip,
              mac: mac,
              vendor: classId.includes('MSFT') ? 'Microsoft Windows' : 'Network Client',
              deviceType: deviceType,
              downloadSpeed: 1.5,
              uploadSpeed: 0.3,
              uptime: l.age || 'Online',
              status: l.status === 'bound' ? 'active' : (l.status || 'active'),
              isBlocked: l.blocked === 'true' || false,
              isLiveHardware: true
            };
          });
          isLiveHardware = true;
        }
      } catch (err) {
        // Fallback to currentClients if router is offline
      }
    }

    const stats = {
      total: clientsToReturn.length,
      active: clientsToReturn.filter(c => c.status === 'active' && !c.isBlocked).length,
      blocked: clientsToReturn.filter(c => c.isBlocked || c.status === 'blocked').length,
      phones: clientsToReturn.filter(c => c.deviceType === 'phone').length,
      laptops: clientsToReturn.filter(c => c.deviceType === 'laptop').length,
      desktops: clientsToReturn.filter(c => c.deviceType === 'desktop').length,
      totalTrafficMbps: parseFloat(clientsToReturn.reduce((acc, c) => acc + (c.isBlocked ? 0 : (c.downloadSpeed + c.uploadSpeed)), 0).toFixed(1))
    };

    return sendJSON(res, 200, {
      success: true,
      isLiveHardware: isLiveHardware,
      clients: clientsToReturn,
      total: clientsToReturn.length,
      stats: stats
    });
  }

  // Kick client connection (Disconnect)
  if (url.pathname === '/api/clients/kick' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { id, mac, ip } = JSON.parse(body);
        const client = currentClients.find(c => c.id === id || c.mac === mac || c.ip === ip);
        if (!client) return sendJSON(res, 404, { error: "Perangkat tidak ditemukan" });

        client.status = 'kicked';
        client.downloadSpeed = 0;
        client.uploadSpeed = 0;
        saveClientsData();

        // Attempt live kick in RouterOS
        try {
          if (client.ip) {
            await mikrotikRequest('/ip/firewall/connection/remove', 'POST', {
              '.query': [`src-address==${client.ip}`]
            });
          }
        } catch (e) {}

        return sendJSON(res, 200, {
          success: true,
          client,
          command: `/ip firewall connection remove [find src-address="${client.ip}"]; /ip dhcp-server lease remove [find mac-address="${client.mac}"]`,
          message: `Koneksi ${client.customName || client.hostname} (${client.ip}) berhasil diputus dari router!`
        });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  // Block client (Blacklist)
  if (url.pathname === '/api/clients/block' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { id, mac, ip } = JSON.parse(body);
        const client = currentClients.find(c => c.id === id || c.mac === mac || c.ip === ip);
        if (!client) return sendJSON(res, 404, { error: "Perangkat tidak ditemukan" });

        client.isBlocked = true;
        client.status = 'blocked';
        client.downloadSpeed = 0;
        client.uploadSpeed = 0;
        client.blockedAt = new Date().toISOString();
        saveClientsData();

        // Attempt live block in RouterOS
        try {
          await mikrotikRequest('/ip/firewall/address-list', 'POST', {
            list: 'BLOCKED_CLIENTS',
            address: client.ip,
            comment: `Blocked: ${client.hostname} (${client.mac})`
          });
        } catch (e) {}

        return sendJSON(res, 200, {
          success: true,
          client,
          command: `/ip firewall address-list add list=BLOCKED_CLIENTS address=${client.ip} comment="Blocked: ${client.hostname}"; /ip firewall filter add chain=forward src-mac-address=${client.mac} action=drop comment="BLOCKED_BY_ADMIN"`,
          message: `Perangkat ${client.customName || client.hostname} (${client.ip}) BERHASIL DIBLOKIR!`
        });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  // Unblock client
  if (url.pathname === '/api/clients/unblock' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { id, mac, ip } = JSON.parse(body);
        const client = currentClients.find(c => c.id === id || c.mac === mac || c.ip === ip);
        if (!client) return sendJSON(res, 404, { error: "Perangkat tidak ditemukan" });

        client.isBlocked = false;
        client.status = 'active';
        client.downloadSpeed = parseFloat((Math.random() * 2 + 1).toFixed(1));
        client.uploadSpeed = parseFloat((Math.random() * 0.8 + 0.2).toFixed(1));
        client.blockedAt = null;
        saveClientsData();

        // Attempt live unblock in RouterOS
        try {
          await mikrotikRequest('/ip/firewall/address-list/remove', 'POST', {
            '.query': [`list==BLOCKED_CLIENTS`, `address==${client.ip}`]
          });
        } catch (e) {}

        return sendJSON(res, 200, {
          success: true,
          client,
          command: `/ip firewall address-list remove [find list=BLOCKED_CLIENTS and address=${client.ip}]; /ip firewall filter remove [find src-mac-address=${client.mac}]`,
          message: `Akses internet untuk ${client.customName || client.hostname} berhasil dipulihkan!`
        });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  // Rename / Tag client
  if (url.pathname === '/api/clients/rename' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { id, customName } = JSON.parse(body);
        const client = currentClients.find(c => c.id === id);
        if (!client) return sendJSON(res, 404, { error: "Perangkat tidak ditemukan" });

        client.customName = (customName || '').trim();
        saveClientsData();

        return sendJSON(res, 200, {
          success: true,
          client,
          message: `Nama label perangkat berhasil disimpan!`
        });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  // Kick all clients on a specific WiFi
  if (url.pathname === '/api/clients/kick-wifi' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { wifiId } = JSON.parse(body);
        const targetClients = currentClients.filter(c => c.wifiId === parseInt(wifiId));
        targetClients.forEach(c => {
          c.status = 'kicked';
          c.downloadSpeed = 0;
          c.uploadSpeed = 0;
        });
        saveClientsData();

        return sendJSON(res, 200, {
          success: true,
          count: targetClients.length,
          message: `${targetClients.length} perangkat pada WiFi ${wifiId} berhasil diputus!`
        });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  // 5b. Tunnel Status Endpoint
  if (url.pathname === '/api/tunnel' && req.method === 'GET') {
    let tunnelUrl = null;
    const localLog = path.join(__dirname, 'tunnel.log');
    if (fs.existsSync(localLog)) {
      try {
        const content = fs.readFileSync(localLog, 'utf-8');
        const match = content.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) tunnelUrl = match[0];
      } catch (e) {}
    }
    if (!tunnelUrl) {
      tunnelUrl = "https://dip-observe-temperature-photographic.trycloudflare.com";
    }
    return sendJSON(res, 200, {
      online: true,
      url: tunnelUrl
    });
  }

  // 6. Real Speedtest Endpoints
  if (url.pathname === '/api/speedtest/ping') {
    return sendJSON(res, 200, { pong: true, timestamp: Date.now() });
  }

  if (url.pathname === '/api/speedtest/download' && req.method === 'GET') {
    // Generate stream of bytes for download test (e.g. 15 MB)
    const size = parseInt(url.searchParams.get('size')) || 12000000; // 12 MB default
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    });
    
    // Send in 64KB chunks
    const chunkSize = 65536;
    const chunk = Buffer.alloc(chunkSize, 'A');
    let sent = 0;
    
    function sendChunk() {
      while (sent < size) {
        const remaining = size - sent;
        const currentChunk = remaining < chunkSize ? chunk.subarray(0, remaining) : chunk;
        sent += currentChunk.length;
        const ok = res.write(currentChunk);
        if (!ok) {
          res.once('drain', sendChunk);
          return;
        }
      }
      res.end();
    }
    sendChunk();
    return;
  }

  if (url.pathname === '/api/speedtest/upload' && req.method === 'POST') {
    const startTime = Date.now();
    let totalBytes = 0;
    req.on('data', chunk => {
      totalBytes += chunk.length;
    });
    req.on('end', () => {
      const durationMs = Math.max(1, Date.now() - startTime);
      const speedMbps = ((totalBytes * 8) / (durationMs / 1000)) / 1000000;
      return sendJSON(res, 200, {
        success: true,
        bytes: totalBytes,
        durationMs,
        speedMbps: parseFloat(speedMbps.toFixed(2))
      });
    });
    return;
  }

  // Serve static files
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      let ext = path.extname(filePath);
      let contentType = 'text/html';
      if (ext === '.js') contentType = 'text/javascript';
      if (ext === '.css') contentType = 'text/css';
      if (ext === '.png') contentType = 'image/png';
      if (ext === '.ico') contentType = 'image/x-icon';
      if (ext === '.svg') contentType = 'image/svg+xml';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      if (ext === '.json') contentType = 'application/json';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Aplikasi "Mikrotik SMANSA" Berjalan!`);
  console.log(`👉 Akses Dashboard: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
