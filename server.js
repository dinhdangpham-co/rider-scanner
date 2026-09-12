/**
 * SPX Rider Scanner v2 — Backend Server
 * Node.js ZERO dependencies — chạy: node server.js
 *
 * FIX: Timezone Vietnam UTC+7
 * NEW: Import master data via Google Sheets TSV URL
 * NEW: 52 riders thật từ data hub
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ===== CONFIG =====
const PORT = process.env.PORT || 3000;
const TZ_OFFSET = 7; // Vietnam UTC+7

function vnNow() {
  const d = new Date();
  d.setHours(d.getHours() + TZ_OFFSET);
  return d.toISOString().replace('Z', '+07:00');
}

function vnToday() {
  const d = new Date();
  d.setHours(d.getHours() + TZ_OFFSET);
  return d.toISOString().slice(0, 10);
}

// ===== FILE-BASED DATABASE =====
const DB_FILE = path.join(__dirname, 'scan_data.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) { console.error('DB load err:', e.message); }
  return { riders: [], scans: [], master_data: [], master_url: '' };
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

let db = loadDB();

// Default 52 riders from hub data
if (db.riders.length === 0) {
  db.riders = [
    { id: 71590, name: "NGUYỄN THÀNH NHÂN", zone: "DAN-123-01" },
    { id: 110870, name: "NGUYỄN THIÊN VIỆT", zone: "DAN-123-02" },
    { id: 137223, name: "LÊ THANH TO", zone: "DAN-123-03" },
    { id: 137769, name: "NGUYỄN AN KHANG", zone: "DAN-123-031" },
    { id: 20408, name: "TRẦN VĂN LỢI", zone: "DAN-123-04" },
    { id: 45020, name: "NGUYỄN VĂN LUẬN", zone: "DAN-123-05" },
    { id: 101726, name: "TRỊNH THỊ KIM THÙY", zone: "DAN-123-06" },
    { id: 111956, name: "NGUYỄN ĐÌNH THANH TUẤN", zone: "DAN-123-07" },
    { id: 139378, name: "PHAN THANH PHONG", zone: "DAN-456-01" },
    { id: 19057, name: "NGUYỄN TUẤN AN", zone: "DAN-456-02" },
    { id: 53828, name: "TRẦN THẾ KHƯƠNG", zone: "DAN-456-03" },
    { id: 142884, name: "PHẠM HUỲNH CHUNG", zone: "DAN-456-04" },
    { id: 119915, name: "TRẦN CẢNH PHONG", zone: "DAN-456-05" },
    { id: 76904, name: "NGUYỄN HỮU PHÚC KHÁNH", zone: "DAN-456-06" },
    { id: 150623, name: "NGÔ NGUYỄN QUỐC KIỆT", zone: "DAN-456-07" },
    { id: 66473, name: "LÊ VĂN KHANG", zone: "DAN-456-08" },
    { id: 99023, name: "NGUYỄN HỮU HIỆP", zone: "DAN-456-09" },
    { id: 152279, name: "HUỲNH CHÍ THIỆN", zone: "DAN-789-01" },
    { id: 55485, name: "NGUYỄN THỊ THU HỒNG", zone: "DAN-789-02" },
    { id: 128358, name: "BÙI QUỐC MẠNH", zone: "DAN-789-03" },
    { id: 154023, name: "NGUYỄN HỮU LỄ", zone: "DAN-789-04" },
    { id: 1, name: "Rider 01" },
    { id: 2, name: "Rider 02" },
    { id: 3, name: "Rider 03" },
    { id: 4, name: "Rider 04" },
    { id: 5, name: "Rider 05" },
    { id: 6, name: "Rider 06" },
    { id: 7, name: "Rider 07" },
    { id: 8, name: "Rider 08" },
    { id: 9, name: "Rider 09" },
    { id: 10, name: "Rider 10" },
    { id: 11, name: "Rider 11" },
    { id: 12, name: "Rider 12" },
    { id: 13, name: "Rider 13" },
    { id: 14, name: "Rider 14" },
    { id: 15, name: "Rider 15" },
    { id: 16, name: "Rider 16" },
    { id: 17, name: "Rider 17" },
    { id: 18, name: "Rider 18" },
    { id: 19, name: "Rider 19" },
    { id: 20, name: "Rider 20" },
    { id: 21, name: "Rider 21" },
    { id: 22, name: "Rider 22" },
    { id: 23, name: "Rider 23" },
    { id: 24, name: "Rider 24" },
    { id: 25, name: "Rider 25" },
    { id: 26, name: "Rider 26" },
    { id: 27, name: "Rider 27" },
    { id: 28, name: "Rider 28" },
    { id: 29, name: "Rider 29" },
    { id: 30, name: "Rider 30" },
  ];
  saveDB(db);
}

// ===== HELPERS =====
function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function fetchURL(targetUrl) {
  return new Promise((resolve, reject) => {
    const mod = targetUrl.startsWith('https') ? https : http;
    mod.get(targetUrl, { headers: { 'User-Agent': 'SPXScanner/1.0' } }, (resp) => {
      // Handle redirects
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return fetchURL(resp.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => resolve(data));
      resp.on('error', reject);
    }).on('error', reject);
  });
}

// Lookup parcel in master data
function lookupParcel(code) {
  if (!code || db.master_data.length === 0) return null;
  const c = code.toUpperCase();
  return db.master_data.find(m => {
    const t = (m.tracking || m.order_id || '').toUpperCase();
    const s = (m.sls_tn || '').toUpperCase();
    return t === c || s === c
      || t === c.replace(/^SPXVN/, 'VN') || t === 'SPXVN' + c.replace(/^VN/, '')
      || s === c.replace(/^SPXVN/, 'VN') || s === 'SPXVN' + c.replace(/^VN/, '');
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ===== HTTP SERVER =====
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // ===== API ROUTES =====

  // GET /api/riders
  if (pathname === '/api/riders' && req.method === 'GET') {
    return sendJSON(res, { success: true, data: db.riders });
  }

  // POST /api/riders
  if (pathname === '/api/riders' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const id = body.id || (db.riders.length > 0 ? Math.max(...db.riders.map(r => r.id)) + 1 : 1);
      const rider = { id, name: body.name, zone: body.zone || '' };
      // Check duplicate
      if (!db.riders.find(r => r.id === id)) {
        db.riders.push(rider);
        saveDB(db);
      }
      return sendJSON(res, { success: true, data: rider }, 201);
    } catch (e) {
      return sendJSON(res, { success: false, error: e.message }, 400);
    }
  }

  // DELETE /api/riders/:id
  if (pathname.startsWith('/api/riders/') && req.method === 'DELETE') {
    const id = parseInt(pathname.split('/').pop());
    db.riders = db.riders.filter(r => r.id !== id);
    saveDB(db);
    return sendJSON(res, { success: true });
  }

  // POST /api/scans — log a scan (TIMEZONE FIXED)
  if (pathname === '/api/scans' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const scan = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        rider_id: body.rider_id,
        rider_name: body.rider_name,
        to_code: body.to_code,
        parcel_code: body.parcel_code,
        scan_type: body.scan_type,
        zone: body.zone || '',
        timestamp: vnNow(), // ← FIXED: Vietnam time
        raw_data: body.raw_data || '',
      };

      // Lookup master data
      let masterMatch = lookupParcel(body.parcel_code);
      if (masterMatch) {
        scan.zone = masterMatch.zone || masterMatch.sort_code || '';
        scan.master_info = {
          sort_code: masterMatch.sort_code || '',
          ward: masterMatch.ward || '',
          status: masterMatch.status || '',
          driver: masterMatch.driver_name || '',
          sls_tn: masterMatch.sls_tn || '',
          weight: masterMatch.weight || '',
        };
      }

      db.scans.push(scan);
      saveDB(db);

      return sendJSON(res, {
        success: true,
        data: scan,
        master_match: masterMatch || null,
      }, 201);
    } catch (e) {
      return sendJSON(res, { success: false, error: e.message }, 400);
    }
  }

  // GET /api/scans
  if (pathname === '/api/scans' && req.method === 'GET') {
    let results = [...db.scans];
    const q = parsed.query;
    if (q.rider_id) results = results.filter(s => String(s.rider_id) === q.rider_id);
    if (q.to_code) results = results.filter(s => s.to_code === q.to_code);
    if (q.date) results = results.filter(s => s.timestamp.startsWith(q.date));
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const limit = parseInt(q.limit) || 500;
    results = results.slice(0, limit);
    return sendJSON(res, { success: true, data: results, total: results.length });
  }

  // GET /api/scans/export — CSV
  if (pathname === '/api/scans/export' && req.method === 'GET') {
    let results = [...db.scans];
    const q = parsed.query;
    if (q.rider_id) results = results.filter(s => String(s.rider_id) === q.rider_id);
    if (q.to_code) results = results.filter(s => s.to_code === q.to_code);
    if (q.date) results = results.filter(s => s.timestamp.startsWith(q.date));
    results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const BOM = '\uFEFF';
    let csv = BOM + 'STT,Rider,Mã TO,Mã đơn,Loại,Zone,Thời gian (VN)\n';
    results.forEach((s, i) => {
      csv += `${i+1},"${s.rider_name}","${s.to_code}","${s.parcel_code}","${s.scan_type}","${s.zone}","${s.timestamp}"\n`;
    });

    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="scans_${vnToday()}.csv"`,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(csv);
  }

  // POST /api/master — upload master data array
  if (pathname === '/api/master' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      if (Array.isArray(body.data)) {
        db.master_data = body.data;
        saveDB(db);
        return sendJSON(res, { success: true, count: db.master_data.length });
      }
      return sendJSON(res, { success: false, error: 'data must be array' }, 400);
    } catch (e) {
      return sendJSON(res, { success: false, error: e.message }, 400);
    }
  }

  // POST /api/master/url — set Google Sheets TSV URL & fetch data
  if (pathname === '/api/master/url' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const sheetUrl = body.url;
      if (!sheetUrl) return sendJSON(res, { success: false, error: 'url required' }, 400);

      db.master_url = sheetUrl;

      // Fetch the TSV/CSV from the URL
      const raw = await fetchURL(sheetUrl);
      const lines = raw.split('\n').filter(l => l.trim());
      if (lines.length < 2) {
        return sendJSON(res, { success: false, error: 'No data found at URL' }, 400);
      }

      // Auto-detect separator
      const sep = lines[0].includes('\t') ? '\t' : ',';
      const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

      const data = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep).map(c => c.trim().replace(/['"]/g, ''));
        const row = {};
        headers.forEach((h, j) => row[h] = cols[j] || '');

        data.push({
          tracking: row['order id'] || row['spx tn'] || row['tracking'] || row['tracking_number'] || cols[0] || '',
          sls_tn: row['sls tracking number'] || row['sls_tn'] || '',
          to_code: row['to number'] || row['to_code'] || row['to'] || '',
          zone: row['zone'] || row['zone id'] || '',
          sort_code: row['sort code name'] || row['sort_code'] || '',
          ward: row['ward name'] || row['ward'] || '',
          status: row['status'] || row['order status'] || '',
          driver_name: row['driver name'] || '',
          driver_id: row['driver id'] || '',
          weight: row['chargeable weight'] || row['order chargeable weight(kg)'] || '',
        });
      }

      db.master_data = data;
      saveDB(db);
      return sendJSON(res, { success: true, count: data.length, url: sheetUrl });
    } catch (e) {
      return sendJSON(res, { success: false, error: e.message }, 400);
    }
  }

  // POST /api/master/refresh — re-fetch from saved URL
  if (pathname === '/api/master/refresh' && req.method === 'POST') {
    if (!db.master_url) return sendJSON(res, { success: false, error: 'No URL saved' }, 400);
    // Redirect to /api/master/url
    try {
      const raw = await fetchURL(db.master_url);
      const lines = raw.split('\n').filter(l => l.trim());
      const sep = lines[0].includes('\t') ? '\t' : ',';
      const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const data = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep).map(c => c.trim().replace(/['"]/g, ''));
        const row = {};
        headers.forEach((h, j) => row[h] = cols[j] || '');
        data.push({
          tracking: row['order id'] || row['spx tn'] || row['tracking'] || cols[0] || '',
          sls_tn: row['sls tracking number'] || row['sls_tn'] || '',
          to_code: row['to number'] || row['to_code'] || '',
          zone: row['zone'] || row['zone id'] || '',
          sort_code: row['sort code name'] || row['sort_code'] || '',
          ward: row['ward name'] || row['ward'] || '',
          status: row['status'] || row['order status'] || '',
          driver_name: row['driver name'] || '',
          driver_id: row['driver id'] || '',
          weight: row['chargeable weight'] || row['order chargeable weight(kg)'] || '',
        });
      }
      db.master_data = data;
      saveDB(db);
      return sendJSON(res, { success: true, count: data.length });
    } catch (e) {
      return sendJSON(res, { success: false, error: e.message }, 400);
    }
  }

  // GET /api/master/lookup?code=xxx
  if (pathname === '/api/master/lookup' && req.method === 'GET') {
    const code = parsed.query.code || '';
    const match = lookupParcel(code);
    return sendJSON(res, { success: true, data: match || null });
  }

  // GET /api/master/info
  if (pathname === '/api/master/info' && req.method === 'GET') {
    return sendJSON(res, {
      success: true,
      count: db.master_data.length,
      url: db.master_url || '',
    });
  }

  // GET /api/stats
  if (pathname === '/api/stats' && req.method === 'GET') {
    const today = vnToday();
    const todayScans = db.scans.filter(s => s.timestamp.startsWith(today));
    const parcelScans = todayScans.filter(s => s.scan_type === 'PARCEL');

    const byRider = {};
    parcelScans.forEach(s => { byRider[s.rider_name] = (byRider[s.rider_name] || 0) + 1; });

    const byTO = {};
    parcelScans.forEach(s => { byTO[s.to_code] = (byTO[s.to_code] || 0) + 1; });

    return sendJSON(res, {
      success: true,
      data: {
        today_total: parcelScans.length,
        today_riders: Object.keys(byRider).length,
        by_rider: byRider,
        by_to: byTO,
        total_all_time: db.scans.filter(s => s.scan_type === 'PARCEL').length,
      }
    });
  }

  // DELETE /api/scans — clear all scans
  if (pathname === '/api/scans' && req.method === 'DELETE') {
    db.scans = [];
    saveDB(db);
    return sendJSON(res, { success: true });
  }

  // GET /api/time — server time check
  if (pathname === '/api/time' && req.method === 'GET') {
    return sendJSON(res, {
      utc: new Date().toISOString(),
      vietnam: vnNow(),
      today: vnToday(),
    });
  }

  // ===== STATIC FILES =====
  let filePath = pathname === '/' ? '/index.html'
    : pathname === '/admin' ? '/admin.html'
    : pathname;
  filePath = path.join(__dirname, 'public', filePath);

  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    return sendJSON(res, { error: 'Forbidden' }, 403);
  }

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
      return res.end(content);
    }
  } catch (e) {}

  return sendJSON(res, { error: 'Not found' }, 404);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║  📦 SPX Rider Scanner v2                         ║
║  Server: http://0.0.0.0:${PORT}                    ║
║  Timezone: Vietnam (UTC+7)                        ║
║                                                   ║
║  Scanner (Rider): http://<ip>:${PORT}               ║
║  Admin Dashboard:  http://<ip>:${PORT}/admin        ║
╚═══════════════════════════════════════════════════╝
  `);
});
