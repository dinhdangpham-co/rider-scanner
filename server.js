/**
 * SPX Scanner v8 — Multi-Hub + RBAC + TO Comparison + Backup
 * Node.js 18+ | Zero dependencies
 *
 * Architecture:
 *  - Multi-hub: each hub has its own GAS URL + Sheet
 *  - RBAC: Admin > Leader > Staff
 *  - URL routing: ?hub=63BDG03
 *  - TO comparison: Raw_TO vs Scan Logs
 *  - Hourly backup to sheet via GAS
 *  - Admin = master sheet User controls all
 *
 * ★ FIX v8.1:
 *  - Sync Logs_Scan tu sheet ve server khi startup (fix KPI = 0)
 *  - gasGet() ho tro extra params (date filter)
 *  - Startup sync nhanh hon (1s thay vi 5s)
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TZ = 7;
const TG_TOKEN = process.env.TG_BOT_TOKEN || '8935458758:AAGtZpKz4ybyYZwNpQZadxpGitfrXbHfcmw';
const TG_CHAT = process.env.TG_CHAT_ID || '1038728579';
const SYNC_INTERVAL = 10 * 60 * 1000;
const BACKUP_INTERVAL = 60 * 60 * 1000; // 1h

function vnNow() { return new Date(Date.now()+TZ*3600000).toISOString().replace('Z','+07:00'); }
function vnToday() { return new Date(Date.now()+TZ*3600000).toISOString().slice(0,10); }

// ===== DB =====
const DB_FILE = path.join(__dirname, 'scan_data.json');
function loadDB() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) {}
  return {
    users: [{ email:'dinhdang.pham@spxexpress.com', password:'1234', status:'Approved', role:'Admin', hub:'ALL', scope:'full', created:vnNow() }],
    hubs: {
      '63BDG03': {
        name: '63-BDG Di An Hub',
        gas_url: 'https://script.google.com/macros/s/AKfycbz9uDCW96ctv_jFGaQzuQaR6uJgJXdlN3O7JljuSI5rQGKtEOHg7lYJzE4DSz24tCos/exec',
        gas_key: 'spx-scanner-2026',
        riders: [],
        scans: [],
        master_data: [],
        raw_to: [],
        sync: { last: '', status: '', error: '' },
      }
    },
    config: { backup_last: '' },
  };
}
function saveDB(d) { try { fs.writeFileSync(DB_FILE, JSON.stringify(d), 'utf8'); } catch(e) {} }
let db = loadDB();
if (!db.hubs) db.hubs = {};
if (!db.users) db.users = [];
if (!db.config) db.config = {};

// Ensure default hub exists
if (!db.hubs['63BDG03']) {
  db.hubs['63BDG03'] = {
    name: '63-BDG Di An Hub',
    gas_url: 'https://script.google.com/macros/s/AKfycbz9uDCW96ctv_jFGaQzuQaR6uJgJXdlN3O7JljuSI5rQGKtEOHg7lYJzE4DSz24tCos/exec',
    gas_key: 'spx-scanner-2026',
    riders: [], scans: [], master_data: [], raw_to: [],
    sync: { last: '', status: '', error: '' },
  };
}
// Ensure default admin
if (!db.users.find(u => u.email === 'dinhdang.pham@spxexpress.com')) {
  db.users.unshift({ email:'dinhdang.pham@spxexpress.com', password:'1234', status:'Approved', role:'Admin', hub:'ALL', scope:'full', created:vnNow() });
}
// Migrate old flat data to hub
if (db.riders && db.riders.length > 0 && (!db.hubs['63BDG03'].riders || db.hubs['63BDG03'].riders.length === 0)) {
  db.hubs['63BDG03'].riders = db.riders;
  db.hubs['63BDG03'].scans = db.scans || [];
  db.hubs['63BDG03'].master_data = db.master_data || [];
  delete db.riders; delete db.scans; delete db.master_data;
  saveDB(db);
}

// Default riders for 63BDG03
const DEFAULT_RIDERS = [
  {id:71590,name:"NGUYỄN THÀNH NHÂN",zone:"DAN-123-01"},{id:110870,name:"NGUYỄN THIÊN VIỆT",zone:"DAN-123-02"},
  {id:137223,name:"LÊ THANH TO",zone:"DAN-123-03"},{id:137769,name:"NGUYỄN AN KHANG",zone:"DAN-123-031"},
  {id:20408,name:"TRẦN VĂN LỢI",zone:"DAN-123-04"},{id:45020,name:"NGUYỄN VĂN LUẬN",zone:"DAN-123-05"},
  {id:101726,name:"TRỊNH THỊ KIM THÙY",zone:"DAN-123-06"},{id:111956,name:"NGUYỄN ĐÌNH THANH TUẤN",zone:"DAN-123-07"},
  {id:139378,name:"PHAN THANH PHONG",zone:"DAN-456-01"},{id:19057,name:"NGUYỄN TUẤN AN",zone:"DAN-456-02"},
  {id:53828,name:"TRẦN THẾ KHƯƠNG",zone:"DAN-456-03"},{id:142884,name:"PHẠM HUỲNH CHUNG",zone:"DAN-456-04"},
  {id:119915,name:"TRẦN CẢNH PHONG",zone:"DAN-456-05"},{id:76904,name:"NGUYỄN HỮU PHÚC KHÁNH",zone:"DAN-456-06"},
  {id:150623,name:"NGÔ NGUYỄN QUỐC KIỆT",zone:"DAN-456-07"},{id:127699,name:"PHAN THANH HẬU",zone:"DAN-456-08"},
  {id:150824,name:"LÊ NGUYÊN PHƯƠNG",zone:"DAN-456-09"},{id:153577,name:"NGUYỄN KHÁNH HUY",zone:"DAN-789-01"},
  {id:99023,name:"NGUYỄN HỮU HIỆP",zone:"DAN-789-02"},{id:152279,name:"HUỲNH CHÍ THIỆN",zone:"DAN-789-03"},
  {id:55485,name:"NGUYỄN THỊ THU HỒNG",zone:"DAN-789-04"},{id:97654,name:"ĐỖ TUẤN HÀO",zone:"DAN-789-06"},
  {id:157133,name:"ĐẶNG HOÀNG PHÚC",zone:"DAN-789-07"},{id:154742,name:"NGUYỄN NGỌC PHI TRƯỜNG",zone:"DAN-789-08"},
  {id:128639,name:"DƯƠNG ANH MINH",zone:"DAN-789-09"},{id:111948,name:"TRƯƠNG NGUYỄN THÔNG",zone:"DAN-789-10"},
  {id:128358,name:"BÙI QUỐC MẠNH",zone:"DAN-789-10"},
  {id:107092,name:"NGUYỄN DƯƠNG QUỐC TUẤN",zone:"DAN-10112-01"},{id:61316,name:"PHẠM THẾ PHONG",zone:"DAN-10112-02"},
  {id:17410,name:"BÙI TẤN PHÁT",zone:"DAN-10112-03"},{id:61780,name:"NGUYỄN KIM VIỆT",zone:"DAN-10112-04"},
  {id:66473,name:"LÊ VĂN KHANG",zone:"DAN-10112-05"},{id:121633,name:"NGUYỄN HÀ ANH VŨ",zone:"DAN-10112-06"},
  {id:107220,name:"TRẦN VIẾT LƯỠNG",zone:"DAN-10112-07"},
  {id:142731,name:"CAO PHONG NHÃ",zone:"DAN-789-05"},{id:145698,name:"ĐẶNG NGỌC QUÝ",zone:"DAN-456-07"},
  {id:151367,name:"ĐẶNG MINH VŨ",zone:"DAN-456-05"},{id:145691,name:"HOÀNG ĐÌNH VĂN",zone:"DAN-789-01"},
  {id:154023,name:"NGUYỄN HỮU LỄ",zone:"DAN-10112-07"},{id:154853,name:"LÊ HÀ ANH TUẤN",zone:"DAN-123-01"},
  {id:154862,name:"HUỲNH ANH KHÔI",zone:"DAN-10112-07"},
];
if (!db.hubs['63BDG03'].riders || db.hubs['63BDG03'].riders.length === 0) {
  db.hubs['63BDG03'].riders = DEFAULT_RIDERS;
  saveDB(db);
}

// ===== HELPERS =====
function getHub(hubId) { return db.hubs[hubId] || null; }
function hubIds() { return Object.keys(db.hubs); }

function cors(r){r.setHeader('Access-Control-Allow-Origin','*');r.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');r.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization')}
function json(r,d,s=200){cors(r);r.writeHead(s,{'Content-Type':'application/json;charset=utf-8'});r.end(JSON.stringify(d))}
function readBody(r){return new Promise((ok,no)=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{ok(JSON.parse(b))}catch(e){no(e)}});r.on('error',no)})}

function fetchUrl(u,depth=0){
  if(depth>5)return Promise.reject(new Error('Too many redirects'));
  return new Promise((ok,no)=>{
    const m=u.startsWith('https')?https:http;
    m.get(u,{headers:{'User-Agent':'Mozilla/5.0','Accept':'*/*'},timeout:15000},r=>{
      if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){let l=r.headers.location;if(l.startsWith('/')){const uu=new URL(u);l=uu.origin+l}r.resume();return fetchUrl(l,depth+1).then(ok).catch(no)}
      if(r.statusCode>=400){r.resume();return no(new Error(`HTTP ${r.statusCode}`))}
      let d='';r.on('data',c=>d+=c);r.on('end',()=>ok(d));r.on('error',no);
    }).on('error',no).on('timeout',()=>no(new Error('Timeout')));
  });
}

function parseTSV(raw){const lines=raw.split('\n').filter(l=>l.trim());if(lines.length<1)return[];const sep=lines[0].includes('\t')?'\t':',';const hdr=lines[0].split(sep).map(h=>h.trim().replace(/^"|"$/g,'').replace(/^\uFEFF/,''));const rows=[];for(let i=1;i<lines.length;i++){const cols=lines[i].split(sep).map(c=>c.trim().replace(/^"|"$/g,''));const obj={};hdr.forEach((h,j)=>obj[h]=cols[j]||'');rows.push(obj)}return rows}

// ===== GAS per hub =====
// ★ FIX: them extraParams de truyen date filter cho getLogs
function gasGet(hubId, action, extraParams) {
  const hub = getHub(hubId);
  if (!hub || !hub.gas_url) return Promise.reject(new Error('Hub not configured'));
  const sep = hub.gas_url.includes('?') ? '&' : '?';
  let url = `${hub.gas_url}${sep}action=${action}&key=${encodeURIComponent(hub.gas_key||'spx-scanner-2026')}`;
  if (extraParams) url += '&' + extraParams;
  return fetchUrl(url);
}

function gasPost(hubId, action, data) {
  const hub = getHub(hubId);
  if (!hub || !hub.gas_url) return Promise.resolve(null);
  const body = JSON.stringify({ action, key: hub.gas_key || 'spx-scanner-2026', data });
  return new Promise((ok, no) => {
    try {
      const u = new URL(hub.gas_url);
      const opts = { hostname:u.hostname, path:u.pathname+u.search, method:'POST', timeout:15000,
        headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} };
      const req = https.request(opts, res => {
        if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();return fetchUrl(res.headers.location).then(ok).catch(no)}
        let d='';res.on('data',c=>d+=c);res.on('end',()=>ok(d));res.on('error',no);
      });
      req.on('error',no);req.on('timeout',()=>no(new Error('Timeout')));
      req.write(body);req.end();
    } catch(e){no(e)}
  });
}

// ===== TELEGRAM =====
function sendTG(text){
  if(!TG_TOKEN||!TG_CHAT)return;
  const body=JSON.stringify({chat_id:TG_CHAT,text,parse_mode:'HTML'});
  const opts={hostname:'api.telegram.org',path:`/bot${TG_TOKEN}/sendMessage`,method:'POST',
    headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}};
  const req=https.request(opts,()=>{});req.on('error',()=>{});req.write(body);req.end();
}

// ===== ZONE LOOKUP =====
function lookupParcel(hubId, code) {
  const hub = getHub(hubId);
  if (!code || !hub || !hub.master_data || !hub.master_data.length) return null;
  const c = code.toUpperCase();
  const vars = [c, c.replace(/^SPXVN/,'VN')];
  if (c.startsWith('VN')) vars.push('SPXVN'+c.slice(2));
  const match = hub.master_data.find(m => {
    const t=(m.tracking||'').toUpperCase(), s=(m.sls_tn||'').toUpperCase();
    return vars.some(v=>v===t||v===s);
  });
  if (match) {
    const zoneId = (match.zone||match.zone_id||'').toUpperCase().replace(/-1$/,'');
    if (zoneId && hub.riders) {
      const zr = hub.riders.filter(r => {
        const rz=(r.zone||'').toUpperCase();
        return rz===zoneId||rz===zoneId+'-1'||zoneId===rz.replace(/-1$/,'');
      });
      match.assigned_riders = zr.map(r=>r.name).join(', ');
      match.zone_clean = zoneId;
    }
  }
  return match;
}

// ===== TO COMPARISON =====
function compareTO(hubId) {
  const hub = getHub(hubId);
  if (!hub) return [];
  const rawTO = hub.raw_to || [];
  const scans = hub.scans || [];
  const today = vnToday();
  const todayScans = scans.filter(s => s.timestamp && s.timestamp.startsWith(today) && s.scan_type === 'PARCEL');

  // Group Raw_TO by TO Number
  const toMap = {};
  rawTO.forEach(r => {
    const to = r.to_code || r['TO Number'] || '';
    if (!to) return;
    if (!toMap[to]) toMap[to] = { toCode: to, systemParcels: [], scannedParcels: [] };
    toMap[to].systemParcels.push(r.tracking || r['SPX TN'] || '');
  });

  // Group scans by TO
  todayScans.forEach(s => {
    const to = s.to_code || '';
    if (!to) return;
    if (!toMap[to]) toMap[to] = { toCode: to, systemParcels: [], scannedParcels: [] };
    toMap[to].scannedParcels.push(s.parcel_code);
  });

  return Object.values(toMap).map(t => {
    const sys = t.systemParcels.length;
    const scn = [...new Set(t.scannedParcels)].length;
    return {
      to: t.toCode,
      system: sys,
      scanned: scn,
      diff: scn - sys,
      status: scn === sys ? 'match' : scn < sys ? 'missing' : 'extra',
      missing: t.systemParcels.filter(p => !t.scannedParcels.includes(p)),
    };
  }).sort((a,b) => Math.abs(b.diff) - Math.abs(a.diff));
}

// ===== SYNC per hub =====
async function syncHub(hubId) {
  const hub = getHub(hubId);
  if (!hub || !hub.gas_url) return;
  console.log(`[Sync] ${hubId} starting...`);
  hub.sync.status = 'syncing';
  try {
    // Rawbatch
    const rawResp = await gasGet(hubId, 'getRawbatch');
    const rawData = JSON.parse(rawResp);
    if (rawData.data && rawData.data.length > 0) {
      const hdr=Object.keys(rawData.data[0]);
      const find=(...keys)=>hdr.find(h=>keys.some(k=>h.toLowerCase().includes(k.toLowerCase())))||'';
      hub.master_data = rawData.data.map(r=>({
        tracking:r[find('Order ID')]||r[find('SPX TN')]||'',sls_tn:r[find('SLS Tracking')]||'',
        zone:r[find('Zone ID')]||r[find('Zone')]||'',sort_code:r[find('Sort Code')]||'',
        ward:r[find('Ward')]||'',status:r[find('Status')]||'',driver_name:r[find('Driver Name')]||'',
        to_code:r[find('TO Number')]||'',weight:r[find('Weight')]||'',
      }));
      console.log(`[Sync] ${hubId} Rawbatch: ${hub.master_data.length}`);
    }
    // RiderMap
    const rResp = await gasGet(hubId, 'getRiderMap');
    const rData = JSON.parse(rResp);
    if (rData.data && rData.data.length > 0) {
      const hdr=Object.keys(rData.data[0]);
      const find=(...keys)=>hdr.find(h=>keys.some(k=>h.toLowerCase().includes(k.toLowerCase())))||'';
      const nr = rData.data.map(r=>({id:parseInt(r[find('ID')])||0,name:r[find('Họ và tên','tên','name')]||'',zone:r[find('Zone ID','zone')]||''})).filter(r=>r.id&&r.name);
      if (nr.length > 0) { hub.riders = nr; console.log(`[Sync] ${hubId} Riders: ${nr.length}`); }
    }
    // Raw_TO
    try {
      const tResp = await gasGet(hubId, 'getRawN');
      const tData = JSON.parse(tResp);
      if (tData.data && tData.data.length > 0) {
        const hdr=Object.keys(tData.data[0]);
        const find=(...keys)=>hdr.find(h=>keys.some(k=>h.toLowerCase().includes(k.toLowerCase())))||'';
        hub.raw_to = tData.data.map(r=>({
          tracking:r[find('SPX TN')]||r[find('Order ID')]||'',sls_tn:r[find('SLS TN')]||'',
          to_code:r[find('TO Number')]||'',status:r[find('Order Status')]||r[find('TO Status')]||'',
          weight:r[find('Weight')]||'',
        }));
        console.log(`[Sync] ${hubId} Raw_TO: ${hub.raw_to.length}`);
      }
    } catch(e) { console.log(`[Sync] ${hubId} Raw_TO skip:`, e.message); }

    // ★ FIX #3: Logs_Scan — pull scan data back from sheet (today only)
    // Khi server restart/wake, scans array trong RAM bi mat
    // → Lay lai du lieu hom nay tu sheet de KPI hien dung
    try {
      const lResp = await gasGet(hubId, 'getLogs', 'date=' + vnToday());
      const lData = JSON.parse(lResp);
      if (lData.data && lData.data.length > 0) {
        // Build set de tranh trung lap voi scan da co trong RAM
        const existingKeys = new Set((hub.scans||[]).map(s =>
          (s.parcel_code||'') + '|' + (s.to_code||'') + '|' + (s.timestamp||'').slice(0,16)
        ));
        let added = 0;
        lData.data.forEach(r => {
          const ts = r['Timestamp'] || '';
          const parcel = r['Parcel Code'] || '';
          const toC = r['TO Code'] || '';
          const key = parcel + '|' + toC + '|' + ts.slice(0,16);
          if (!existingKeys.has(key) && (parcel || toC)) {
            hub.scans.push({
              id: 'sheet-' + Date.now() + '-' + (++added),
              rider_name: r['Rider Name'] || '',
              rider_id: r['Rider ID'] || '',
              to_code: toC,
              parcel_code: parcel,
              scan_type: 'PARCEL',
              zone: r['Zone'] || '',
              zone_clean: r['Zone'] || '',
              sort_code: r['Sort Code'] || '',
              ward: r['Ward'] || '',
              status: r['Status'] || '',
              driver: r['Driver'] || '',
              assigned_riders: '',
              timestamp: ts
            });
            existingKeys.add(key);
          }
        });
        console.log(`[Sync] ${hubId} Logs: ${added} restored from sheet (total scans: ${hub.scans.length})`);
      }
    } catch(e) { console.log(`[Sync] ${hubId} Logs skip:`, e.message); }

    hub.sync.last = vnNow(); hub.sync.status = 'ok'; hub.sync.error = '';
    saveDB(db);
  } catch(e) {
    console.error(`[Sync] ${hubId} error:`, e.message);
    hub.sync.status = 'error'; hub.sync.error = e.message;
  }
}

async function syncAllHubs() {
  for (const hid of hubIds()) { await syncHub(hid).catch(e => console.error('[Sync]', hid, e.message)); }
}

// ===== BACKUP to Sheet =====
async function backupHub(hubId) {
  const hub = getHub(hubId);
  if (!hub || !hub.gas_url) return;
  const today = vnToday();
  const todayScans = (hub.scans||[]).filter(s=>s.timestamp&&s.timestamp.startsWith(today));
  const toComp = compareTO(hubId);
  const byR = {};
  todayScans.forEach(s=>{ if(s.scan_type==='PARCEL') byR[s.rider_name]=(byR[s.rider_name]||0)+1; });

  try {
    await gasPost(hubId, 'backup', {
      hub: hubId,
      timestamp: vnNow(),
      today_scans: todayScans.length,
      rider_counts: byR,
      to_comparison: toComp.slice(0, 50),
      riders_active: Object.keys(byR).length,
      riders_total: (hub.riders||[]).length,
    });
    console.log(`[Backup] ${hubId} done`);
  } catch(e) { console.log(`[Backup] ${hubId} err:`, e.message); }
}

async function backupAll() {
  db.config.backup_last = vnNow();
  for (const hid of hubIds()) { await backupHub(hid).catch(e=>{}); }
  saveDB(db);
}

// ===== RBAC =====
function checkRole(user, requiredRole) {
  const ranks = { Admin: 3, Leader: 2, Staff: 1 };
  return (ranks[user.role] || 0) >= (ranks[requiredRole] || 0);
}
function userHubs(user) {
  if (user.role === 'Admin' || user.hub === 'ALL') return hubIds();
  return [user.hub].filter(h => db.hubs[h]);
}

// ===== ROUTES =====
const MIME={'.html':'text/html;charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};

const server = http.createServer(async(req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host}`);
  const p=u.pathname;
  const q=Object.fromEntries(u.searchParams);
  const hubId = q.hub || '63BDG03'; // default hub
  if(req.method==='OPTIONS'){cors(res);res.writeHead(204);return res.end()}

  try {

  // ── LOGIN ──
  if(p==='/api/login'&&req.method==='POST'){
    const body=await readBody(req);
    const{email,password}=body;
    if(!email||!password)return json(res,{success:false,error:'Nhập email và mật khẩu'},400);
    let match=db.users.find(u=>u.email.toLowerCase().trim()===email.toLowerCase().trim()&&String(u.password).trim()===String(password).trim()&&(u.status||'').toLowerCase()==='approved');
    // Try GAS if not found locally
    if(!match){
      for(const hid of hubIds()){
        try{const resp=await gasGet(hid,'getUsers');const data=JSON.parse(resp);
          if(data.data){match=data.data.find(r=>(r.Email||'').toLowerCase().trim()===email.toLowerCase().trim()&&String(r.Password||'').trim()===String(password).trim()&&(r.Status||'').toLowerCase()==='approved');
            if(match){match={email:match.Email,role:match.Role||'Staff',hub:match.Hub||hid,scope:match.Scope||'scan_only'};break}
          }
        }catch(e){}
      }
    }
    if(!match)return json(res,{success:false,error:'Sai email/mật khẩu hoặc chưa được duyệt'},401);
    const token=Date.now().toString(36)+Math.random().toString(36).slice(2);
    return json(res,{success:true,token,email:match.email||email,role:match.role||'Staff',hub:match.hub||hubId,scope:match.scope||'',hubs:userHubs(match)});
  }

  // ── REGISTER ──
  if(p==='/api/register'&&req.method==='POST'){
    const body=await readBody(req);
    if(!body.email||!body.password)return json(res,{success:false,error:'Nhập email và mật khẩu'},400);
    if(db.users.find(u=>u.email.toLowerCase()===body.email.toLowerCase()))return json(res,{success:false,error:'Email đã tồn tại'},400);
    const user={email:body.email.trim(),password:String(body.password).trim(),status:'Pending',role:'Staff',hub:body.hub||hubId,scope:'scan_only',created:vnNow()};
    db.users.push(user);saveDB(db);
    gasPost(hubId,'registerUser',{email:user.email,password:user.password}).catch(e=>{});
    sendTG(`📝 <b>Đăng ký mới</b>\n${user.email}\nHub: ${user.hub}\n${vnNow().slice(0,19)}`);
    return json(res,{success:true,message:'Đăng ký thành công! Chờ Admin duyệt.'});
  }

  // ── USERS (Admin only) ──
  if(p==='/api/users'&&req.method==='GET')return json(res,{success:true,data:db.users.map(u=>({email:u.email,status:u.status,role:u.role,hub:u.hub,scope:u.scope,created:u.created}))});
  if(p==='/api/users'&&req.method==='POST'){const body=await readBody(req);if(db.users.find(u=>u.email.toLowerCase()===body.email.toLowerCase()))return json(res,{success:false,error:'Exists'},400);db.users.push({email:body.email,password:String(body.password||'1234'),status:body.status||'Approved',role:body.role||'Staff',hub:body.hub||hubId,scope:body.scope||'scan_only',created:vnNow()});saveDB(db);return json(res,{success:true})}
  if(p==='/api/users/approve'&&req.method==='POST'){const body=await readBody(req);const user=db.users.find(u=>u.email.toLowerCase()===body.email.toLowerCase());if(!user)return json(res,{success:false},404);user.status='Approved';if(body.role)user.role=body.role;if(body.hub)user.hub=body.hub;if(body.scope)user.scope=body.scope;saveDB(db);gasPost(user.hub!=='ALL'?user.hub:hubId,'approveUser',{email:user.email}).catch(e=>{});return json(res,{success:true})}
  if(p==='/api/users/update'&&req.method==='POST'){const body=await readBody(req);const user=db.users.find(u=>u.email.toLowerCase()===body.email.toLowerCase());if(!user)return json(res,{success:false},404);if(body.role!==undefined)user.role=body.role;if(body.hub!==undefined)user.hub=body.hub;if(body.scope!==undefined)user.scope=body.scope;if(body.status!==undefined)user.status=body.status;saveDB(db);return json(res,{success:true})}
  if(p==='/api/users/reject'&&req.method==='POST'){const body=await readBody(req);db.users=db.users.filter(u=>u.email.toLowerCase()!==body.email.toLowerCase());saveDB(db);return json(res,{success:true})}

  // ── HUBS (Admin) ──
  if(p==='/api/hubs'&&req.method==='GET')return json(res,{success:true,data:Object.entries(db.hubs).map(([id,h])=>({id,name:h.name,gas_url:h.gas_url?'✅':'❌',riders:h.riders?.length||0,scans:h.scans?.length||0,master:h.master_data?.length||0,raw_to:h.raw_to?.length||0,sync:h.sync}))});
  if(p==='/api/hubs'&&req.method==='POST'){
    const body=await readBody(req);
    if(!body.id||!body.name)return json(res,{success:false,error:'ID and name required'},400);
    if(db.hubs[body.id])return json(res,{success:false,error:'Hub already exists'},400);
    db.hubs[body.id]={name:body.name,gas_url:body.gas_url||'',gas_key:body.gas_key||'spx-scanner-2026',riders:[],scans:[],master_data:[],raw_to:[],sync:{last:'',status:'',error:''}};
    saveDB(db);return json(res,{success:true});
  }
  if(p==='/api/hubs/update'&&req.method==='POST'){
    const body=await readBody(req);const hub=getHub(body.id);if(!hub)return json(res,{success:false,error:'Not found'},404);
    if(body.name)hub.name=body.name;if(body.gas_url!==undefined)hub.gas_url=body.gas_url;if(body.gas_key!==undefined)hub.gas_key=body.gas_key;
    saveDB(db);return json(res,{success:true});
  }
  if(p==='/api/hubs/delete'&&req.method==='POST'){
    const body=await readBody(req);if(body.id==='63BDG03')return json(res,{success:false,error:'Cannot delete default hub'},400);
    delete db.hubs[body.id];saveDB(db);return json(res,{success:true});
  }

  // ── RIDERS (per hub) ──
  if(p==='/api/riders'&&req.method==='GET'){const hub=getHub(hubId);return json(res,{success:true,data:hub?hub.riders||[]:[]})}
  if(p==='/api/riders'&&req.method==='POST'){const body=await readBody(req);const hub=getHub(hubId);if(!hub)return json(res,{success:false},400);const id=body.id||(hub.riders.length>0?Math.max(...hub.riders.map(r=>r.id))+1:1);if(!hub.riders.find(r=>r.id===id)){hub.riders.push({id,name:body.name,zone:body.zone||''});saveDB(db)}return json(res,{success:true},201)}

  // ── SCANS (per hub) ──
  if(p==='/api/scans'&&req.method==='POST'){
    const body=await readBody(req);const hub=getHub(hubId);if(!hub)return json(res,{success:false,error:'Hub not found'},400);
    const scan={id:Date.now()+'-'+Math.random().toString(36).slice(2,8),rider_id:body.rider_id,rider_name:body.rider_name,to_code:body.to_code,parcel_code:body.parcel_code,scan_type:body.scan_type||'PARCEL',zone:'',zone_clean:'',sort_code:'',ward:'',status:'',driver:'',assigned_riders:'',timestamp:vnNow()};
    const m=lookupParcel(hubId,body.parcel_code);
    if(m){scan.zone=m.zone||m.zone_id||'';scan.zone_clean=m.zone_clean||'';scan.sort_code=m.sort_code||'';scan.ward=m.ward||'';scan.status=m.status||'';scan.driver=m.driver_name||'';scan.assigned_riders=m.assigned_riders||''}
    hub.scans.push(scan);saveDB(db);
    gasPost(hubId,'logScan',{timestamp:scan.timestamp,rider_name:scan.rider_name,rider_id:scan.rider_id,to_code:scan.to_code,parcel_code:scan.parcel_code,zone:scan.zone_clean||scan.zone,sort_code:scan.sort_code,ward:scan.ward,status:scan.status,driver:scan.driver}).catch(e=>{});
    return json(res,{success:true,data:scan,match:m||null},201);
  }
  if(p==='/api/scans'&&req.method==='GET'){
    const hub=getHub(hubId);if(!hub)return json(res,{success:true,data:[],total:0});
    let r=[...(hub.scans||[])];
    if(q.rider_id)r=r.filter(s=>String(s.rider_id)===q.rider_id);
    if(q.to_code)r=r.filter(s=>s.to_code===q.to_code);
    if(q.date)r=r.filter(s=>s.timestamp&&s.timestamp.startsWith(q.date));
    if(q.search){const s=q.search.toUpperCase();r=r.filter(x=>[x.parcel_code,x.rider_name,x.to_code,x.zone].some(v=>(v||'').toUpperCase().includes(s)))}
    r.sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
    return json(res,{success:true,data:r.slice(0,parseInt(q.limit)||500),total:r.length});
  }
  if(p==='/api/scans'&&req.method==='DELETE'){const hub=getHub(hubId);if(hub)hub.scans=[];saveDB(db);return json(res,{success:true})}
  if(p==='/api/scans/export'&&req.method==='GET'){
    const hub=getHub(hubId);let r=[...(hub?.scans||[])];
    if(q.date)r=r.filter(s=>s.timestamp&&s.timestamp.startsWith(q.date));
    r.sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||''));
    let csv='\uFEFFSTT,Tài xế,Mã TO,Mã đơn,Zone,Sort Code,Phường,Tài xế zone,Thời gian\n';
    r.forEach((s,i)=>{csv+=`${i+1},"${s.rider_name}","${s.to_code}","${s.parcel_code}","${s.zone_clean||s.zone}","${s.sort_code}","${s.ward}","${s.assigned_riders}","${s.timestamp}"\n`});
    cors(res);res.writeHead(200,{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':`attachment;filename="scans_${hubId}_${vnToday()}.csv"`});return res.end(csv);
  }

  // ── TO COMPARISON ──
  if(p==='/api/to-compare'&&req.method==='GET'){
    return json(res,{success:true,data:compareTO(hubId)});
  }

  // ── STATS (per hub) ──
  if(p==='/api/stats'&&req.method==='GET'){
    const hub=getHub(hubId);if(!hub)return json(res,{success:true,data:{today_total:0,today_riders:0,by_rider:{},by_to:{},total_all_time:0}});
    const today=vnToday();const ts=(hub.scans||[]).filter(s=>s.timestamp&&s.timestamp.startsWith(today)&&s.scan_type==='PARCEL');
    const byR={},byT={};ts.forEach(s=>{byR[s.rider_name]=(byR[s.rider_name]||0)+1;byT[s.to_code]=(byT[s.to_code]||0)+1});
    // Rider-TO mapping
    const riderTOs={};ts.forEach(s=>{if(!riderTOs[s.rider_name])riderTOs[s.rider_name]=new Set();riderTOs[s.rider_name].add(s.to_code)});
    const riderTOCount={};Object.entries(riderTOs).forEach(([r,tos])=>{riderTOCount[r]={count:tos.size,tos:[...tos]}});
    return json(res,{success:true,data:{today_total:ts.length,today_riders:Object.keys(byR).length,by_rider:byR,by_to:byT,rider_tos:riderTOCount,total_all_time:(hub.scans||[]).filter(s=>s.scan_type==='PARCEL').length}});
  }

  // ── MASTER DATA ──
  if(p==='/api/master/upload'&&req.method==='POST'){const body=await readBody(req);const hub=getHub(hubId);if(hub&&Array.isArray(body.data)){hub.master_data=body.data;saveDB(db)}return json(res,{success:true,count:hub?.master_data?.length||0})}
  if(p==='/api/master/tsv'&&req.method==='POST'){
    const body=await readBody(req);const hub=getHub(hubId);if(!hub)return json(res,{success:false},400);
    try{const raw=await fetchUrl(body.url);const rows=parseTSV(raw);if(!rows.length)return json(res,{success:false,error:'No data'},400);
      const hdr=Object.keys(rows[0]);const find=(...keys)=>hdr.find(h=>keys.some(k=>h.toLowerCase().includes(k.toLowerCase())))||'';
      hub.master_data=rows.map(r=>({tracking:r[find('Order ID')]||r[find('SPX TN')]||'',sls_tn:r[find('SLS Tracking')]||'',zone:r[find('Zone ID')]||r[find('Zone')]||'',sort_code:r[find('Sort Code')]||'',ward:r[find('Ward')]||'',status:r[find('Status')]||'',driver_name:r[find('Driver Name')]||'',to_code:r[find('TO Number')]||'',weight:r[find('Weight')]||''}));
      saveDB(db);return json(res,{success:true,count:hub.master_data.length});
    }catch(e){return json(res,{success:false,error:e.message},400)}
  }
  if(p==='/api/master/info'&&req.method==='GET'){const hub=getHub(hubId);return json(res,{success:true,count:hub?.master_data?.length||0,riders:hub?.riders?.length||0,raw_to:hub?.raw_to?.length||0})}

  // ── SYNC ──
  if(p==='/api/sync'&&req.method==='POST'){syncHub(hubId).catch(e=>{});return json(res,{success:true,message:'Syncing...'})}
  if(p==='/api/sync/status'&&req.method==='GET'){const hub=getHub(hubId);return json(res,{success:true,data:hub?{...hub.sync,master_count:hub.master_data?.length||0,rider_count:hub.riders?.length||0,raw_to_count:hub.raw_to?.length||0,scan_count:hub.scans?.length||0}:{}})}
  if(p==='/api/sync/all'&&req.method==='POST'){syncAllHubs().catch(e=>{});return json(res,{success:true})}

  // ── BACKUP ──
  if(p==='/api/backup'&&req.method==='POST'){backupAll().catch(e=>{});return json(res,{success:true,message:'Backing up...'})}

  // ── CONFIG ──
  if(p==='/api/config'&&req.method==='GET'){const hub=getHub(hubId);return json(res,{success:true,data:{hub_id:hubId,hub_name:hub?.name||'',gas_url:hub?.gas_url||'',gas_key:hub?.gas_key||'',master_count:hub?.master_data?.length||0,rider_count:hub?.riders?.length||0,user_count:db.users.length,scan_count:hub?.scans?.length||0,raw_to_count:hub?.raw_to?.length||0,sync:hub?.sync||{},backup_last:db.config.backup_last||''}})}

  if(p==='/api/telegram/test'&&req.method==='POST'){sendTG(`✅ <b>SPX Scanner AI</b>\nTest OK | Hub: ${hubId}\n${vnNow()}`);return json(res,{success:true})}
  if(p==='/api/time')return json(res,{utc:new Date().toISOString(),vietnam:vnNow(),today:vnToday()});

  // ── STATIC ──
  let fp=p==='/'?'/index.html':p==='/admin'?'/admin.html':p;
  fp=path.join(__dirname,'public',fp);
  if(!fp.startsWith(path.join(__dirname,'public')))return json(res,{error:'Forbidden'},403);
  try{if(fs.existsSync(fp)&&fs.statSync(fp).isFile()){res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-cache'});return res.end(fs.readFileSync(fp))}}catch(e){}
  return json(res,{error:'Not found'},404);

  }catch(e){console.error('Err:',e);return json(res,{success:false,error:e.message},500)}
});

server.listen(PORT,'0.0.0.0',()=>{
  console.log(`\n📦 SPX Scanner v8.1 Multi-Hub | http://0.0.0.0:${PORT} | VN UTC+7`);
  console.log(`   Hubs: ${hubIds().join(', ')} | TG: ${TG_TOKEN?'✅':'❌'}\n`);
  // ★ FIX: Sync ngay 1s sau start (thay vi 5s) — de data co nhanh hon
  setTimeout(()=>syncAllHubs().catch(e=>console.error('[Sync]',e.message)),1000);
  // Periodic sync
  setInterval(()=>syncAllHubs().catch(e=>{}),SYNC_INTERVAL);
  // Hourly backup
  setInterval(()=>backupAll().catch(e=>{}),BACKUP_INTERVAL);
});
