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
      if (ext === '.jpg') contentType = 'image/jpeg';
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
