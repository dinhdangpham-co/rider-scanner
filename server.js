/**
 * SPX Rider Scanner v5
 * Node.js 18+ | Zero dependencies
 *
 * v5: Google Sheets read/write via Apps Script proxy
 *     Telegram alerts
 *     Fixed zone + rider lookup
 *     Auto-sync every 10 min
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TZ = 7;
const GAS_URL = process.env.GAS_URL || '';
const GAS_KEY = process.env.GAS_KEY || 'spx-scanner-2026';
const TG_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT = process.env.TG_CHAT_ID || '';
const SYNC_INTERVAL = 10 * 60 * 1000; // 10 min

function vnNow() { return new Date(Date.now()+TZ*3600000).toISOString().replace('Z','+07:00'); }
function vnToday() { return new Date(Date.now()+TZ*3600000).toISOString().slice(0,10); }
function vnHour() { return new Date(Date.now()+TZ*3600000).getUTCHours(); }

// ===== DB =====
const DB_FILE = path.join(__dirname,'scan_data.json');
function loadDB(){try{if(fs.existsSync(DB_FILE))return JSON.parse(fs.readFileSync(DB_FILE,'utf8'))}catch(e){}return{users:[],riders:[],scans:[],master_data:[],config:{gas_url:'',gas_key:'spx-scanner-2026'},sync:{last:'',status:'',error:''}}}
function saveDB(d){try{fs.writeFileSync(DB_FILE,JSON.stringify(d),'utf8')}catch(e){}}
let db = loadDB();
if(!db.users)db.users=[];
if(!db.riders)db.riders=[];
if(!db.scans)db.scans=[];
if(!db.master_data)db.master_data=[];
if(!db.config)db.config={};
if(!db.sync)db.sync={last:'',status:'',error:''};

// Default admin
if(db.users.length===0) db.users.push({email:'dinhdang.pham@spxexpress.com',password:'1234',status:'Approved',role:'Admin',created:vnNow()});

// Default riders (from RiderMap)
if(db.riders.length===0){
  db.riders=[
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
    {id:152141,name:"ĐỖ THANH PHONG",zone:"DAN-789-031"},{id:55485,name:"NGUYỄN THỊ THU HỒNG",zone:"DAN-789-04"},
    {id:47443,name:"PHAN THÁI NHẬT PHÁT",zone:"DAN-789-05"},{id:97654,name:"ĐỖ TUẤN HÀO",zone:"DAN-789-06"},
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
  saveDB(db);
}

// ===== HTTP HELPERS =====
function cors(r){r.setHeader('Access-Control-Allow-Origin','*');r.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');r.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization')}
function json(r,d,s=200){cors(r);r.writeHead(s,{'Content-Type':'application/json;charset=utf-8'});r.end(JSON.stringify(d))}
function readBody(r){return new Promise((ok,no)=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{ok(JSON.parse(b))}catch(e){no(e)}});r.on('error',no)})}

// ===== FETCH URL (for legacy TSV) =====
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

// ===== GOOGLE APPS SCRIPT PROXY =====
function gasGet(action) {
  const gasUrl = db.config.gas_url || GAS_URL;
  if (!gasUrl) return Promise.reject(new Error('GAS_URL chưa cấu hình. Vào Cài đặt → dán URL Apps Script.'));
  const key = db.config.gas_key || GAS_KEY;
  const url = `${gasUrl}?action=${action}&key=${encodeURIComponent(key)}`;
  return fetchUrl(url);
}

function gasPost(action, data) {
  const gasUrl = db.config.gas_url || GAS_URL;
  if (!gasUrl) return Promise.resolve(null);
  const key = db.config.gas_key || GAS_KEY;
  const body = JSON.stringify({ action, key, data });

  return new Promise((ok, no) => {
    const u = new URL(gasUrl);
    const opts = {
      hostname: u.hostname, path: u.pathname, method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, res => {
      // Apps Script returns 302 redirect on POST
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect with GET (Apps Script behavior)
        res.resume();
        return fetchUrl(res.headers.location).then(ok).catch(no);
      }
      let d = ''; res.on('data', c => d += c); res.on('end', () => ok(d)); res.on('error', no);
    });
    req.on('error', no); req.on('timeout', () => no(new Error('Timeout')));
    req.write(body); req.end();
  });
}

// ===== TELEGRAM =====
function sendTG(text) {
  const token = TG_TOKEN;
  const chat = TG_CHAT;
  if (!token || !chat) return;
  const body = JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML' });
  const opts = {
    hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };
  const req = https.request(opts, () => {});
  req.on('error', e => console.error('TG err:', e.message));
  req.write(body); req.end();
}

// ===== ZONE LOOKUP (FIXED) =====
function lookupParcel(code) {
  if (!code || !db.master_data.length) return null;
  const c = code.toUpperCase();
  const variants = [c, c.replace(/^SPXVN/,'VN')];
  if (c.startsWith('VN')) variants.push('SPXVN'+c.slice(2));

  const match = db.master_data.find(m => {
    const t = (m.tracking||'').toUpperCase();
    const s = (m.sls_tn||'').toUpperCase();
    return variants.some(v => v===t || v===s);
  });

  if (match) {
    // ★ Cross-reference zone with RiderMap to find assigned rider
    const zoneId = (match.zone || match.zone_id || '').toUpperCase().replace(/-1$/,''); // strip trailing -1
    if (zoneId) {
      const zoneRiders = db.riders.filter(r => {
        const rz = (r.zone||'').toUpperCase();
        return rz === zoneId || rz === zoneId + '-1' || zoneId === rz.replace(/-1$/,'');
      });
      match.assigned_riders = zoneRiders.map(r => r.name).join(', ');
      match.zone_clean = zoneId;
    }
  }
  return match;
}

// ===== AUTO SYNC FROM GOOGLE SHEETS =====
let syncFails = 0;

async function syncFromSheets() {
  const gasUrl = db.config.gas_url || GAS_URL;
  if (!gasUrl) { db.sync.status = 'no_url'; return; }

  console.log('[Sync] Starting...');
  db.sync.status = 'syncing';

  try {
    // Sync Rawbatch → master_data
    const rawResp = await gasGet('getRawbatch');
    const rawData = JSON.parse(rawResp);
    if (rawData.data && rawData.data.length > 0) {
      const hdr = Object.keys(rawData.data[0]);
      const find = (...keys) => hdr.find(h => keys.some(k => h.toLowerCase().includes(k.toLowerCase()))) || '';

      db.master_data = rawData.data.map(r => ({
        tracking: r[find('Order ID')] || r[find('SPX TN')] || '',
        sls_tn: r[find('SLS Tracking')] || '',
        zone: r[find('Zone ID')] || r[find('Zone')] || '',
        zone_id: r[find('Zone ID')] || '',
        sort_code: r[find('Sort Code')] || '',
        ward: r[find('Ward')] || '',
        status: r[find('Status')] || '',
        driver_name: r[find('Driver Name')] || '',
        to_code: r[find('TO Number')] || '',
        weight: r[find('Chargeable Weight')] || r[find('Weight')] || '',
      }));
      console.log(`[Sync] Rawbatch: ${db.master_data.length} rows`);
    }

    // Sync RiderMap → riders
    const riderResp = await gasGet('getRiderMap');
    const riderData = JSON.parse(riderResp);
    if (riderData.data && riderData.data.length > 0) {
      const newRiders = riderData.data.map(r => {
        const hdr = Object.keys(r);
        const find = (...keys) => hdr.find(h => keys.some(k => h.toLowerCase().includes(k.toLowerCase()))) || '';
        return {
          id: parseInt(r[find('ID')]) || 0,
          name: r[find('Họ và tên','tên','name')] || '',
          zone: r[find('Zone ID','zone')] || '',
        };
      }).filter(r => r.id && r.name);
      if (newRiders.length > 0) {
        db.riders = newRiders;
        console.log(`[Sync] RiderMap: ${db.riders.length} riders`);
      }
    }

    db.sync.last = vnNow();
    db.sync.status = 'ok';
    db.sync.error = '';
    syncFails = 0;
    saveDB(db);

  } catch(e) {
    console.error('[Sync] Error:', e.message);
    db.sync.status = 'error';
    db.sync.error = e.message;
    syncFails++;

    // Alert on 3 consecutive failures
    if (syncFails === 3) {
      sendTG(`⚠️ <b>SPX Scanner</b>\nSync thất bại 3 lần liên tiếp!\n${e.message}`);
    }
  }
}

// ===== ROUTES =====
const MIME={'.html':'text/html;charset=utf-8','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.css':'text/css','.ico':'image/x-icon'};

const server = http.createServer(async(req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host}`);
  const p=u.pathname;
  const q=Object.fromEntries(u.searchParams);
  if(req.method==='OPTIONS'){cors(res);res.writeHead(204);return res.end()}

  try {

  // ── LOGIN ──
  if (p==='/api/login'&&req.method==='POST'){
    const body=await readBody(req);
    const{email,password}=body;
    if(!email||!password)return json(res,{success:false,error:'Nhập email và mật khẩu'},400);

    // Check local users
    let match=db.users.find(u=>u.email.toLowerCase().trim()===email.toLowerCase().trim()&&String(u.password).trim()===String(password).trim()&&(u.status||'').toLowerCase()==='approved');

    // If not found, try Google Sheets via Apps Script
    if(!match&&(db.config.gas_url||GAS_URL)){
      try{
        const resp=await gasGet('getUsers');
        const data=JSON.parse(resp);
        if(data.data){
          match=data.data.find(r=>(r.Email||'').toLowerCase().trim()===email.toLowerCase().trim()&&String(r.Password||'').trim()===String(password).trim()&&(r.Status||'').toLowerCase()==='approved');
        }
      }catch(e){console.log('Sheet auth err:',e.message)}
    }

    if(!match)return json(res,{success:false,error:'Email/mật khẩu sai hoặc chưa được duyệt'},401);
    const token=Date.now().toString(36)+Math.random().toString(36).slice(2);
    return json(res,{success:true,token,email});
  }

  // ── REGISTER ──
  if(p==='/api/register'&&req.method==='POST'){
    const body=await readBody(req);
    const{email,password}=body;
    if(!email||!password)return json(res,{success:false,error:'Nhập email và mật khẩu'},400);
    if(password.length<4)return json(res,{success:false,error:'Mật khẩu tối thiểu 4 ký tự'},400);
    if(db.users.find(u=>u.email.toLowerCase().trim()===email.toLowerCase().trim()))return json(res,{success:false,error:'Email đã tồn tại'},400);

    const user={email:email.trim(),password:String(password).trim(),status:'Pending',role:'User',created:vnNow()};
    db.users.push(user);saveDB(db);

    // ★ Write to Google Sheets (fire-and-forget)
    gasPost('registerUser',{email:user.email,password:user.password}).catch(e=>console.log('Sheet reg err:',e.message));

    // ★ Telegram alert
    sendTG(`📝 <b>Đăng ký mới</b>\n${email}\n${vnNow().slice(0,19)}`);

    return json(res,{success:true,message:'Đăng ký thành công! Chờ Admin duyệt.'});
  }

  // ── USERS ──
  if(p==='/api/users'&&req.method==='GET')return json(res,{success:true,data:db.users.map(u=>({email:u.email,status:u.status,role:u.role,created:u.created}))});
  if(p==='/api/users'&&req.method==='POST'){const body=await readBody(req);if(db.users.find(u=>u.email.toLowerCase()===body.email.toLowerCase()))return json(res,{success:false,error:'Email đã tồn tại'},400);db.users.push({email:body.email,password:String(body.password),status:body.status||'Approved',role:body.role||'User',created:vnNow()});saveDB(db);return json(res,{success:true})}
  if(p==='/api/users/approve'&&req.method==='POST'){const body=await readBody(req);const user=db.users.find(u=>u.email.toLowerCase()===body.email.toLowerCase());if(!user)return json(res,{success:false,error:'Not found'},404);user.status='Approved';saveDB(db);gasPost('approveUser',{email:user.email}).catch(e=>{});return json(res,{success:true})}
  if(p==='/api/users/reject'&&req.method==='POST'){const body=await readBody(req);db.users=db.users.filter(u=>u.email.toLowerCase()!==body.email.toLowerCase());saveDB(db);return json(res,{success:true})}

  // ── RIDERS ──
  if(p==='/api/riders'&&req.method==='GET')return json(res,{success:true,data:db.riders});
  if(p==='/api/riders'&&req.method==='POST'){const body=await readBody(req);const id=body.id||(db.riders.length>0?Math.max(...db.riders.map(r=>r.id))+1:1);if(!db.riders.find(r=>r.id===id)){db.riders.push({id,name:body.name,zone:body.zone||''});saveDB(db)}return json(res,{success:true},201)}

  // ── SCANS (★ with zone lookup + sheet log + telegram) ──
  if(p==='/api/scans'&&req.method==='POST'){
    const body=await readBody(req);
    const scan={
      id:Date.now()+'-'+Math.random().toString(36).slice(2,8),
      rider_id:body.rider_id,rider_name:body.rider_name,
      to_code:body.to_code,parcel_code:body.parcel_code,
      scan_type:body.scan_type||'PARCEL',
      zone:'',zone_clean:'',sort_code:'',ward:'',status:'',driver:'',assigned_riders:'',
      timestamp:vnNow(),
    };

    // ★ ZONE LOOKUP
    const m=lookupParcel(body.parcel_code);
    if(m){
      scan.zone=m.zone||m.zone_id||'';
      scan.zone_clean=m.zone_clean||'';
      scan.sort_code=m.sort_code||'';
      scan.ward=m.ward||'';
      scan.status=m.status||'';
      scan.driver=m.driver_name||'';
      scan.assigned_riders=m.assigned_riders||'';
    }

    db.scans.push(scan);saveDB(db);

    // ★ Log to Google Sheets (fire-and-forget)
    gasPost('logScan',{
      timestamp:scan.timestamp,rider_name:scan.rider_name,rider_id:scan.rider_id,
      to_code:scan.to_code,parcel_code:scan.parcel_code,
      zone:scan.zone_clean||scan.zone,sort_code:scan.sort_code,
      ward:scan.ward,status:scan.status,driver:scan.driver,
    }).catch(e=>console.log('Sheet log err:',e.message));

    return json(res,{success:true,data:scan,match:m||null},201);
  }

  if(p==='/api/scans'&&req.method==='GET'){
    let r=[...db.scans];
    if(q.rider_id)r=r.filter(s=>String(s.rider_id)===q.rider_id);
    if(q.to_code)r=r.filter(s=>s.to_code===q.to_code);
    if(q.date)r=r.filter(s=>s.timestamp.startsWith(q.date));
    if(q.search){const s=q.search.toUpperCase();r=r.filter(x=>(x.parcel_code||'').toUpperCase().includes(s)||(x.rider_name||'').toUpperCase().includes(s)||(x.to_code||'').toUpperCase().includes(s)||(x.zone||'').toUpperCase().includes(s))}
    r.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
    return json(res,{success:true,data:r.slice(0,parseInt(q.limit)||500),total:r.length});
  }
  if(p==='/api/scans'&&req.method==='DELETE'){db.scans=[];saveDB(db);return json(res,{success:true})}
  if(p==='/api/scans/export'&&req.method==='GET'){
    let r=[...db.scans];
    if(q.rider_id)r=r.filter(s=>String(s.rider_id)===q.rider_id);
    if(q.to_code)r=r.filter(s=>s.to_code===q.to_code);
    if(q.date)r=r.filter(s=>s.timestamp.startsWith(q.date));
    r.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
    let csv='\uFEFFSTT,Tài xế,Mã TO,Mã đơn,Zone,Sort Code,Phường,Tài xế zone,Thời gian\n';
    r.forEach((s,i)=>{csv+=`${i+1},"${s.rider_name}","${s.to_code}","${s.parcel_code}","${s.zone_clean||s.zone}","${s.sort_code}","${s.ward}","${s.assigned_riders}","${s.timestamp}"\n`});
    cors(res);res.writeHead(200,{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':`attachment;filename="scans_${vnToday()}.csv"`});return res.end(csv);
  }

  // ── MASTER DATA (manual upload fallback) ──
  if(p==='/api/master/upload'&&req.method==='POST'){const body=await readBody(req);if(Array.isArray(body.data)){db.master_data=body.data;saveDB(db)}return json(res,{success:true,count:db.master_data.length})}
  if(p==='/api/master/info'&&req.method==='GET')return json(res,{success:true,count:db.master_data.length,riders:db.riders.length});

  // ── SYNC ──
  if(p==='/api/sync'&&req.method==='POST'){
    syncFromSheets().then(()=>console.log('[Sync] Manual sync done')).catch(e=>console.error('[Sync] err:',e));
    return json(res,{success:true,message:'Đang sync...'});
  }
  if(p==='/api/sync/status'&&req.method==='GET'){
    return json(res,{success:true,data:{last:db.sync.last,status:db.sync.status,error:db.sync.error,master_count:db.master_data.length,rider_count:db.riders.length}});
  }

  // ── CONFIG ──
  if(p==='/api/config'&&req.method==='GET')return json(res,{success:true,data:{gas_url:db.config.gas_url||GAS_URL||'',gas_key:db.config.gas_key||'',master_count:db.master_data.length,rider_count:db.riders.length,user_count:db.users.length,scan_count:db.scans.length,sync:db.sync}});
  if(p==='/api/config'&&req.method==='POST'){const body=await readBody(req);if(body.gas_url!==undefined)db.config.gas_url=body.gas_url;if(body.gas_key!==undefined)db.config.gas_key=body.gas_key;saveDB(db);return json(res,{success:true})}

  // ── STATS ──
  if(p==='/api/stats'&&req.method==='GET'){
    const today=vnToday();const ts=db.scans.filter(s=>s.timestamp.startsWith(today)&&s.scan_type==='PARCEL');
    const byR={},byT={};ts.forEach(s=>{byR[s.rider_name]=(byR[s.rider_name]||0)+1;byT[s.to_code]=(byT[s.to_code]||0)+1});
    return json(res,{success:true,data:{today_total:ts.length,today_riders:Object.keys(byR).length,by_rider:byR,by_to:byT,total_all_time:db.scans.filter(s=>s.scan_type==='PARCEL').length}});
  }

  // ── TELEGRAM TEST ──
  if(p==='/api/telegram/test'&&req.method==='POST'){
    sendTG(`✅ <b>SPX Scanner</b>\nTest thành công!\n${vnNow()}`);
    return json(res,{success:true,message:'Đã gửi tin nhắn test'});
  }

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
  console.log(`\n📦 SPX Scanner v5 | http://0.0.0.0:${PORT} | VN UTC+7`);
  console.log(`   GAS: ${GAS_URL?'✅ configured':'⚠️ not set'} | TG: ${TG_TOKEN?'✅':'⚠️ not set'}\n`);

  // Auto-sync on startup (delay 5s to let server warm up)
  setTimeout(()=>{
    if(db.config.gas_url||GAS_URL){
      syncFromSheets().then(()=>console.log('[Sync] Startup sync done')).catch(e=>console.error('[Sync] Startup err:',e.message));
    }
  },5000);

  // Periodic sync every 10 min
  setInterval(()=>{
    if(db.config.gas_url||GAS_URL){
      syncFromSheets().catch(e=>console.error('[Sync] Periodic err:',e.message));
    }
  },SYNC_INTERVAL);
});
