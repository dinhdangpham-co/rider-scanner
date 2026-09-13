/**
 * SPX Rider Scanner v3 — Backend
 * Zero dependencies, Node.js 18+
 *
 * CHANGES v3:
 * - Admin login via Google Sheets User tab
 * - Zone lookup from Rawbatch/Data sheet
 * - Vietnam timezone (UTC+7) for all timestamps
 * - RiderMap from sheet (49 riders)
 * - Multiple TSV sheet URL support
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TZ = 7; // UTC+7

// ===== TIME HELPERS =====
function vnNow() {
  const d = new Date(Date.now() + TZ * 3600000);
  return d.toISOString().replace('Z', '+07:00');
}
function vnToday() {
  return new Date(Date.now() + TZ * 3600000).toISOString().slice(0, 10);
}

// ===== DB =====
const DB_FILE = path.join(__dirname, 'scan_data.json');
function loadDB() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) {}
  return { riders:[], scans:[], master_data:[], config:{ data_url:'', user_url:'' }, sessions:{} };
}
function saveDB(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d), 'utf8'); }
let db = loadDB();

// Default riders
if (!db.riders || db.riders.length === 0) {
  db.riders = [
    {id:71590,name:"NGUYỄN THÀNH NHÂN",zone:"DAN-123-01"},
    {id:110870,name:"NGUYỄN THIÊN VIỆT",zone:"DAN-123-02"},
    {id:137223,name:"LÊ THANH TO",zone:"DAN-123-03"},
    {id:137769,name:"NGUYỄN AN KHANG",zone:"DAN-123-031"},
    {id:20408,name:"TRẦN VĂN LỢI",zone:"DAN-123-04"},
    {id:45020,name:"NGUYỄN VĂN LUẬN",zone:"DAN-123-05"},
    {id:101726,name:"TRỊNH THỊ KIM THÙY",zone:"DAN-123-06"},
    {id:111956,name:"NGUYỄN ĐÌNH THANH TUẤN",zone:"DAN-123-07"},
    {id:139378,name:"PHAN THANH PHONG",zone:"DAN-456-01"},
    {id:19057,name:"NGUYỄN TUẤN AN",zone:"DAN-456-02"},
    {id:53828,name:"TRẦN THẾ KHƯƠNG",zone:"DAN-456-03"},
    {id:142884,name:"PHẠM HUỲNH CHUNG",zone:"DAN-456-04"},
    {id:119915,name:"TRẦN CẢNH PHONG",zone:"DAN-456-05"},
    {id:76904,name:"NGUYỄN HỮU PHÚC KHÁNH",zone:"DAN-456-06"},
    {id:150623,name:"NGÔ NGUYỄN QUỐC KIỆT",zone:"DAN-456-07"},
    {id:127699,name:"PHAN THANH HẬU",zone:"DAN-456-08"},
    {id:150824,name:"LÊ NGUYÊN PHƯƠNG",zone:"DAN-456-09"},
    {id:153577,name:"NGUYỄN KHÁNH HUY",zone:"DAN-789-01"},
    {id:99023,name:"NGUYỄN HỮU HIỆP",zone:"DAN-789-02"},
    {id:152279,name:"HUỲNH CHÍ THIỆN",zone:"DAN-789-03"},
    {id:152141,name:"ĐỖ THANH PHONG",zone:"DAN-789-031"},
    {id:55485,name:"NGUYỄN THỊ THU HỒNG",zone:"DAN-789-04"},
    {id:47443,name:"PHAN THÁI NHẬT PHÁT",zone:"DAN-789-05"},
    {id:97654,name:"ĐỖ TUẤN HÀO",zone:"DAN-789-06"},
    {id:157133,name:"ĐẶNG HOÀNG PHÚC",zone:"DAN-789-07"},
    {id:154742,name:"NGUYỄN NGỌC PHI TRƯỜNG",zone:"DAN-789-08"},
    {id:128639,name:"DƯƠNG ANH MINH",zone:"DAN-789-09"},
    {id:111948,name:"TRƯƠNG NGUYỄN THÔNG",zone:"DAN-789-10"},
    {id:128358,name:"BÙI QUỐC MẠNH",zone:"DAN-789-10"},
    {id:107092,name:"NGUYỄN DƯƠNG QUỐC TUẤN",zone:"DAN-10112-01"},
    {id:61316,name:"PHẠM THẾ PHONG",zone:"DAN-10112-02"},
    {id:17410,name:"BÙI TẤN PHÁT",zone:"DAN-10112-03"},
    {id:61780,name:"NGUYỄN KIM VIỆT",zone:"DAN-10112-04"},
    {id:66473,name:"LÊ VĂN KHANG",zone:"DAN-10112-05"},
    {id:121633,name:"NGUYỄN HÀ ANH VŨ",zone:"DAN-10112-06"},
    {id:107220,name:"TRẦN VIẾT LƯỠNG",zone:"DAN-10112-07"},
    {id:142731,name:"CAO PHONG NHÃ",zone:"DAN-789-05"},
    {id:145698,name:"ĐẶNG NGỌC QUÝ",zone:"DAN-456-07"},
    {id:151367,name:"ĐẶNG MINH VŨ",zone:"DAN-456-05"},
    {id:145691,name:"HOÀNG ĐÌNH VĂN",zone:"DAN-789-01"},
    {id:154023,name:"NGUYỄN HỮU LỄ",zone:"DAN-10112-07"},
    {id:154853,name:"LÊ HÀ ANH TUẤN",zone:"DAN-123-01"},
    {id:154862,name:"HUỲNH ANH KHÔI",zone:"DAN-10112-07"},
  ];
  if (!db.config) db.config = {};
  saveDB(db);
}
if (!db.config) db.config = { data_url:'', user_url:'' };
if (!db.sessions) db.sessions = {};

// ===== HTTP HELPERS =====
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
}
function json(res, data, status=200) {
  cors(res);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((ok,no) => {
    let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{ok(JSON.parse(b))}catch(e){no(e)} }); req.on('error',no);
  });
}
function fetchUrl(u) {
  return new Promise((ok,no) => {
    const m = u.startsWith('https') ? https : http;
    m.get(u, {headers:{'User-Agent':'SPXScanner/2.0'}}, r => {
      if (r.statusCode>=300 && r.statusCode<400 && r.headers.location) return fetchUrl(r.headers.location).then(ok).catch(no);
      if (r.statusCode >= 400) return no(new Error('HTTP '+r.statusCode));
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>ok(d)); r.on('error',no);
    }).on('error',no);
  });
}

// Parse TSV/CSV
function parseTSV(raw) {
  const lines = raw.split('\n').filter(l=>l.trim());
  if (lines.length<2) return [];
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const hdr = lines[0].split(sep).map(h=>h.trim().replace(/^"|"$/g,''));
  const rows = [];
  for (let i=1;i<lines.length;i++) {
    const cols = lines[i].split(sep).map(c=>c.trim().replace(/^"|"$/g,''));
    const obj = {};
    hdr.forEach((h,j)=> obj[h]=cols[j]||'');
    rows.push(obj);
  }
  return rows;
}

// Lookup parcel
function lookupParcel(code) {
  if (!code || !db.master_data.length) return null;
  const c = code.toUpperCase();
  const c2 = c.replace(/^SPXVN/,'VN');
  const c3 = c.startsWith('VN') ? 'SPXVN'+c.slice(2) : '';
  return db.master_data.find(m => {
    const t = (m.tracking||'').toUpperCase();
    const s = (m.sls_tn||'').toUpperCase();
    return t===c||s===c||t===c2||s===c2||(c3&&(t===c3||s===c3));
  });
}

// ===== ROUTES =====
const MIME = {'.html':'text/html;charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  const q = Object.fromEntries(u.searchParams);

  if (req.method==='OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  try {

  // ── AUTH ──
  if (p==='/api/login' && req.method==='POST') {
    const body = await readBody(req);
    const {email,password} = body;
    if (!email||!password) return json(res,{success:false,error:'Nhập email và mật khẩu'},400);

    // Try fetching User sheet from config URL
    let users = [];
    if (db.config.user_url) {
      try {
        const raw = await fetchUrl(db.config.user_url);
        users = parseTSV(raw);
      } catch(e) { console.error('User sheet fetch err:',e.message); }
    }

    // Fallback: hardcoded admin
    if (users.length === 0) {
      users = [{Email:'dinhdang.pham@spxexpress.com',Password:'1234',Status:'Approved'}];
    }

    const match = users.find(u =>
      u.Email && u.Email.toLowerCase().trim() === email.toLowerCase().trim() &&
      String(u.Password).trim() === String(password).trim() &&
      (u.Status||'').toLowerCase() === 'approved'
    );

    if (!match) return json(res,{success:false,error:'Email hoặc mật khẩu sai, hoặc tài khoản chưa được duyệt'},401);

    const token = Date.now().toString(36)+Math.random().toString(36).slice(2);
    db.sessions[token] = {email,time:vnNow()};
    return json(res,{success:true,token,email,name:match.Notes||'User'});
  }

  // ── CONFIG ──
  if (p==='/api/config' && req.method==='GET') {
    return json(res,{success:true,data:{data_url:db.config.data_url||'',user_url:db.config.user_url||'',master_count:db.master_data.length}});
  }
  if (p==='/api/config' && req.method==='POST') {
    const body = await readBody(req);
    if (body.data_url !== undefined) db.config.data_url = body.data_url;
    if (body.user_url !== undefined) db.config.user_url = body.user_url;
    saveDB(db);
    return json(res,{success:true});
  }

  // ── RIDERS ──
  if (p==='/api/riders' && req.method==='GET') {
    return json(res,{success:true,data:db.riders});
  }
  if (p==='/api/riders' && req.method==='POST') {
    const body = await readBody(req);
    const id = body.id || (db.riders.length>0 ? Math.max(...db.riders.map(r=>r.id))+1 : 1);
    if (!db.riders.find(r=>r.id===id)) {
      db.riders.push({id,name:body.name,zone:body.zone||''});
      saveDB(db);
    }
    return json(res,{success:true},201);
  }
  if (p.startsWith('/api/riders/') && req.method==='DELETE') {
    const id = parseInt(p.split('/').pop());
    db.riders = db.riders.filter(r=>r.id!==id);
    saveDB(db);
    return json(res,{success:true});
  }

  // ── SCANS ──
  if (p==='/api/scans' && req.method==='POST') {
    const body = await readBody(req);
    const scan = {
      id: Date.now()+'-'+Math.random().toString(36).slice(2,8),
      rider_id:body.rider_id, rider_name:body.rider_name,
      to_code:body.to_code, parcel_code:body.parcel_code,
      scan_type:body.scan_type||'PARCEL',
      zone:'', sort_code:'', ward:'', status:'', driver:'',
      timestamp: vnNow(),
    };
    const match = lookupParcel(body.parcel_code);
    if (match) {
      scan.zone = match.zone || match.zone_id || '';
      scan.sort_code = match.sort_code || '';
      scan.ward = match.ward || '';
      scan.status = match.status || '';
      scan.driver = match.driver_name || '';
    }
    db.scans.push(scan);
    saveDB(db);
    return json(res,{success:true,data:scan,match:match||null},201);
  }
  if (p==='/api/scans' && req.method==='GET') {
    let r = [...db.scans];
    if (q.rider_id) r=r.filter(s=>String(s.rider_id)===q.rider_id);
    if (q.to_code) r=r.filter(s=>s.to_code===q.to_code);
    if (q.date) r=r.filter(s=>s.timestamp.startsWith(q.date));
    r.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
    r = r.slice(0, parseInt(q.limit)||500);
    return json(res,{success:true,data:r,total:r.length});
  }
  if (p==='/api/scans' && req.method==='DELETE') {
    db.scans=[]; saveDB(db);
    return json(res,{success:true});
  }
  if (p==='/api/scans/export' && req.method==='GET') {
    let r = [...db.scans];
    if (q.rider_id) r=r.filter(s=>String(s.rider_id)===q.rider_id);
    if (q.to_code) r=r.filter(s=>s.to_code===q.to_code);
    if (q.date) r=r.filter(s=>s.timestamp.startsWith(q.date));
    r.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
    let csv = '\uFEFFSTT,Tài xế,Mã TO,Mã đơn,Zone,Sort Code,Phường,Trạng thái,Thời gian\n';
    r.forEach((s,i)=>{ csv+=`${i+1},"${s.rider_name}","${s.to_code}","${s.parcel_code}","${s.zone}","${s.sort_code}","${s.ward}","${s.status}","${s.timestamp}"\n`; });
    cors(res);
    res.writeHead(200,{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':`attachment;filename="scans_${vnToday()}.csv"`});
    return res.end(csv);
  }

  // ── MASTER DATA ──
  if (p==='/api/master/load' && req.method==='POST') {
    const body = await readBody(req);
    const targetUrl = body.url || db.config.data_url;
    if (!targetUrl) return json(res,{success:false,error:'Chưa cấu hình URL dữ liệu'},400);

    try {
      const raw = await fetchUrl(targetUrl);
      const rows = parseTSV(raw);
      if (rows.length===0) return json(res,{success:false,error:'Không có dữ liệu'},400);

      const hdr = Object.keys(rows[0]);
      // Auto-detect columns
      const findCol = (...keys) => hdr.find(h => keys.some(k => h.toLowerCase().includes(k))) || '';
      const colTracking = findCol('order id','spx tn','tracking');
      const colSLS = findCol('sls tracking','sls_tn');
      const colZone = findCol('zone id','zone');
      const colSort = findCol('sort code');
      const colWard = findCol('ward');
      const colStatus = findCol('status');
      const colDriver = findCol('driver name');
      const colTO = findCol('to number','to_code');
      const colWeight = findCol('chargeable weight','weight');

      db.master_data = rows.map(r => ({
        tracking: r[colTracking]||'',
        sls_tn: r[colSLS]||'',
        zone: r[colZone]||'',
        zone_id: r[findCol('zone id')]||'',
        sort_code: r[colSort]||'',
        ward: r[colWard]||'',
        status: r[colStatus]||'',
        driver_name: r[colDriver]||'',
        to_code: r[colTO]||'',
        weight: r[colWeight]||'',
      }));

      if (body.url) { db.config.data_url = body.url; }
      saveDB(db);
      return json(res,{success:true,count:db.master_data.length,columns:hdr.slice(0,10)});
    } catch(e) {
      return json(res,{success:false,error:'Lỗi tải dữ liệu: '+e.message},400);
    }
  }
  if (p==='/api/master/upload' && req.method==='POST') {
    const body = await readBody(req);
    if (Array.isArray(body.data)) { db.master_data=body.data; saveDB(db); }
    return json(res,{success:true,count:db.master_data.length});
  }
  if (p==='/api/master/lookup' && req.method==='GET') {
    return json(res,{success:true,data:lookupParcel(q.code)||null});
  }
  if (p==='/api/master/info' && req.method==='GET') {
    return json(res,{success:true,count:db.master_data.length,url:db.config.data_url||''});
  }

  // ── STATS ──
  if (p==='/api/stats' && req.method==='GET') {
    const today = vnToday();
    const ts = db.scans.filter(s=>s.timestamp.startsWith(today)&&s.scan_type==='PARCEL');
    const byR={}, byT={};
    ts.forEach(s=>{ byR[s.rider_name]=(byR[s.rider_name]||0)+1; byT[s.to_code]=(byT[s.to_code]||0)+1; });
    return json(res,{success:true,data:{
      today_total:ts.length, today_riders:Object.keys(byR).length,
      by_rider:byR, by_to:byT,
      total_all_time:db.scans.filter(s=>s.scan_type==='PARCEL').length,
    }});
  }

  // ── TIME ──
  if (p==='/api/time') return json(res,{utc:new Date().toISOString(),vietnam:vnNow(),today:vnToday()});

  // ── STATIC FILES ──
  let fp = p==='/' ? '/index.html' : p==='/admin' ? '/admin.html' : p;
  fp = path.join(__dirname,'public',fp);
  if (!fp.startsWith(path.join(__dirname,'public'))) return json(res,{error:'Forbidden'},403);
  try {
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ext = path.extname(fp);
      res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':'no-cache'});
      return res.end(fs.readFileSync(fp));
    }
  } catch(e){}
  return json(res,{error:'Not found'},404);

  } catch(e) {
    console.error('Server error:',e);
    return json(res,{success:false,error:e.message},500);
  }
});

server.listen(PORT,'0.0.0.0',()=>{
  console.log(`\n📦 SPX Scanner v3 | http://0.0.0.0:${PORT} | Timezone: VN (UTC+7)\n`);
});
