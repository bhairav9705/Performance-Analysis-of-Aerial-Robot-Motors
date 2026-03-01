// --- tabs ---
const LIVE_POLL_MS = 200; // 5 Hz (was 1000 ms)
const LIVE_DRAW_MS = 50;  // ~20 FPS drawing

const tabs = [
  {btn: document.getElementById('tab-home'), panel: document.getElementById('panel-home')},
  {btn: document.getElementById('tab-live'), panel: document.getElementById('panel-live')},
  {btn: document.getElementById('tab-analysis'), panel: document.getElementById('panel-analysis')}
];
tabs.forEach(({btn, panel}) => {
  btn.addEventListener('click', () => {
    tabs.forEach(t => {
      const sel = (t.btn === btn);
      t.btn.setAttribute('aria-selected', sel);
      t.panel.setAttribute('aria-hidden', !sel);
    });
    if (btn.id === 'tab-live') startLive(); else stopLive();
    if (btn.id === 'tab-analysis') initAnalysis();
  });
});

// --- elements used by both sections (declare once) ---
const throttleEl   = document.getElementById('throttle');
const throttleValEl= document.getElementById('throttle-val');
const armBtn       = document.getElementById('arm-btn');
const armToast     = document.getElementById('arm-toast');

const thrustEl     = document.getElementById('thrust');
const thrustValEl  = document.getElementById('thrust-val');
const stepEl       = document.getElementById('log-step');
const rampEl       = document.getElementById('ramp-time');
const startBtn     = document.getElementById('start-test-btn');
const testToast    = document.getElementById('test-toast');

const anBrandEl = document.getElementById('an-mbrand');
const anMotorEl = document.getElementById('an-motor');
const anKVEl    = document.getElementById('an-kv');
const anPropEl  = document.getElementById('an-prop');
const anESCEl   = document.getElementById('an-esc');
const anDescEl  = document.getElementById('an-desc');
// --- mini chart (same as before, omitted for brevity) ---
class MiniChart {
  constructor(canvas, opts) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = opts.maxPoints ?? 120;
    this.unit = opts.unit ?? '';
    this.fixedRange = opts.range || null;
    this.series = [];
    this.grid = {left: 48, right: 12, top: 8, bottom: 22};
    this.lastValueEl = opts.lastValueEl || null;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      this.c.width  = Math.floor(this.c.clientWidth  * dpr);
      this.c.height = Math.floor(this.c.clientHeight * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    };
    new ResizeObserver(resize).observe(this.c);
    resize();
  }
  addPoint(t, y) {
    this.series.push({t, y});
    if (this.series.length > this.maxPoints) this.series.shift();
    if (this.lastValueEl) this.lastValueEl.textContent = `${y.toFixed(2)} ${this.unit}`;
  }
  _rangeY() {
    if (this.fixedRange) return this.fixedRange;
    if (!this.series.length) return {min:0, max:1};
    let min = +Infinity, max = -Infinity;
    for (const p of this.series) { if (p.y<min) min=p.y; if (p.y>max) max=p.y; }
    if (min === max) { min -= 1; max += 1; }
    const pad = (max-min)*0.15;
    return {min:min-pad, max:max+pad};
  }
  draw() {
    const ctx = this.ctx, W = this.c.clientWidth, H = this.c.clientHeight;
    ctx.clearRect(0,0,W,H);
    const g = this.grid, iw = W - g.left - g.right, ih = H - g.top - g.bottom;
    ctx.strokeStyle = '#243042'; ctx.lineWidth = 1; ctx.strokeRect(g.left, g.top, iw, ih);
    const {min, max} = this._rangeY(), ticks = 4;
    ctx.fillStyle = '#8fa1b3'; ctx.font = '12px system-ui, sans-serif';
    for (let i=0;i<=ticks;i++){
      const yv = min + (i*(max-min)/ticks), y = g.top + ih - (i*ih/ticks);
      ctx.globalAlpha = 0.2; ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.left+iw, y); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillText(yv.toFixed(2), 6, y+4);
    }
    if (this.series.length > 1) {
      const tmin = this.series[0].t, tmax = this.series[this.series.length-1].t;
      const span = Math.max(1, (tmax - tmin)/1000);
      const step = span>90 ? 30 : span>60 ? 20 : span>30 ? 10 : 5;
      for (let s=Math.ceil((tmin/1000)/step)*step; s<=tmax/1000; s+=step){
        const t = s*1000;
        const x = g.left + ((t - tmin)/(tmax - tmin)) * iw;
        ctx.globalAlpha = 0.2; ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, g.top+ih); ctx.stroke();
        ctx.globalAlpha = 1;   ctx.fillText(`${Math.round((tmax - t)/1000)}s`, x-10, g.top+ih+16);
      }
    } else {
      ctx.fillText('Time (s)', g.left+iw-60, g.top+ih+16);
    }
    if (this.series.length >= 2) {
      ctx.save(); ctx.beginPath();
      const t0 = this.series[0].t, t1 = this.series[this.series.length-1].t, T = (t1 - t0) || 1;
      for (let i=0;i<this.series.length;i++){
        const p = this.series[i];
        const x = g.left + ((p.t - t0) / T) * (W - g.left - g.right);
        const y = g.top + (H - g.top - g.bottom) - ((p.y - this._rangeY().min) / (this._rangeY().max - this._rangeY().min)) * (H - g.top - g.bottom);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.strokeStyle = '#5dd0ff'; ctx.lineWidth = 2; ctx.stroke();
      const lp = this.series[this.series.length-1];
      const lx = g.left + ((lp.t - t0) / T) * (W - g.left - g.right);
      const ly = g.top + (H - g.top - g.bottom) - ((lp.y - this._rangeY().min) / (this._rangeY().max - this._rangeY().min)) * (H - g.top - g.bottom);
      ctx.fillStyle = '#5dd0ff'; ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }
}
// --- Live charts (unchanged logic) ---
const MAX_POINTS = Math.round(120000 / LIVE_POLL_MS); // ~120 seconds of history

const charts = {
  v: new MiniChart(document.getElementById('voltage'), {unit:'V',  range:{min:9.0, max:13.0}, lastValueEl: document.getElementById('v-last'), maxPoints: MAX_POINTS}),
  i: new MiniChart(document.getElementById('current'), {unit:'A',  range:{min:0.0, max:40.0}, lastValueEl: document.getElementById('i-last'), maxPoints: MAX_POINTS}),
  p: new MiniChart(document.getElementById('power'),   {unit:'W',  range:{min:0.0,  max:600.0}, lastValueEl: document.getElementById('p-last'), maxPoints: MAX_POINTS}),
  l: new MiniChart(document.getElementById('load'),    {unit:'kg', range:{min:0.0, max:5.0},  lastValueEl: document.getElementById('l-last'), maxPoints: MAX_POINTS})
};
charts.addPoint = (t, v, i, kg) => {
  const pwr = v * i;
  charts.v.addPoint(t, v);
  charts.i.addPoint(t, i);
  charts.p.addPoint(t, pwr);
  charts.l.addPoint(t, kg);
};

let liveTimer = null, drawTimer = null;
let liveReqBusy = false; // prevent overlapping fetches

function startLive() {
  if (liveTimer) return;

  liveTimer = setInterval(async () => {
    if (liveReqBusy) return;
    liveReqBusy = true;
    try {
      const r = await fetch('/api/live', { cache: 'no-store' });
      const { ts, v, i, kg } = await r.json();
      charts.addPoint((ts ? ts * 1000 : Date.now()), v, i, kg);
    } catch {}
    finally { liveReqBusy = false; }
  }, LIVE_POLL_MS);

  drawTimer = setInterval(() => {
    charts.v.draw(); charts.i.draw(); charts.p.draw(); charts.l.draw();
  }, LIVE_DRAW_MS);
}

function stopLive() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  if (drawTimer) { clearInterval(drawTimer); drawTimer = null; }
}
// --- helpers ---
function toast(el, msg) { el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(()=> el.hidden = true, 2000); }

// ===================== Throttle test =====================
let isArmed = false;           // UI notion (backend prints; we keep simple)
let pendingSend = null;

function setArmUI(armed) {
  isArmed = armed;
  armBtn.textContent = armed ? 'Disarm' : 'Arm';
  armBtn.classList.toggle('armed', armed);
  armBtn.setAttribute('aria-pressed', armed ? 'true' : 'false');
  document.getElementById('arm-hint').innerHTML = armed
    ? 'Move the slider to change throttle. Press <b>Disarm</b> to stop (sends 0%).'
    : 'Set a value, then press <b>Arm</b>.';
  // While ARMED, disable Start Test (visual + functional)
  startBtn.disabled = armed || testRunning;
}
function updateThrottleLabel() { throttleValEl.textContent = String(throttleEl.value); }

async function postThrottle(pct) {
  const r = await fetch('/api/set_throttle', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ pct: String(pct) })
  });
  return r.json();
}

throttleEl.addEventListener('input', () => {
  updateThrottleLabel();
  if (!isArmed) return;
  clearTimeout(pendingSend);
  pendingSend = setTimeout(async () => {
    try {
      const { ok } = await postThrottle(Number(throttleEl.value));
      if (ok) toast(armToast, `Throttle set to ${throttleEl.value}%`);
    } catch {}
  }, 120);
});

armBtn.addEventListener('click', async () => {
  try {
    if (!isArmed) {
      const { ok } = await postThrottle(Number(throttleEl.value));
      if (ok) { setArmUI(true); toast(armToast, `Armed at ${throttleEl.value}%`); }
    } else {
      throttleEl.value = '0'; updateThrottleLabel();
      const { ok } = await postThrottle(0);
      if (ok) { setArmUI(false); toast(armToast, 'Disarmed (0%)'); }
    }
  } catch {}
});

updateThrottleLabel();

// ===================== Thrust test =====================
let testRunning = false;
let statusTimer = null;

function setTestUI(running) {
  testRunning = running;
  // Disable Arm button (visual + functional) while test runs
  armBtn.disabled = running;
  startBtn.disabled = isArmed;
  startBtn.textContent = running ? 'Stop Test' : 'Start Test';
  // Lock inputs during the test
  thrustEl.disabled = running;
  stepEl.disabled = running;
  rampEl.disabled = running;
}

function updateThrustLabel() {
   const raw = Number(thrustEl.value);
   const q = Math.max(0, Math.min(100, Math.round(raw / 10) * 10));
   if (q !== raw) thrustEl.value = String(q);  // keep slider aligned to 10s
   thrustValEl.textContent = String(q);
 }
thrustEl.addEventListener('input',  updateThrustLabel);
thrustEl.addEventListener('change', updateThrustLabel);
updateThrustLabel(); // initialize label from the current slider value


async function startThrustTest() {
  if (isArmed) { toast(testToast, 'Disarm before starting the test'); return; }
  const pct = Number(thrustEl.value);
  const step_s = Number(stepEl.value) || 0.5;
  const ramp_s = Number(rampEl.value) || 10;
  try {
    const r = await fetch('/api/start_thrust_test', {
      method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({
        pct: String(pct),
        step_s: String(step_s),
        ramp_s: String(ramp_s)
     })
    });
    const j = await r.json();
    if (j.ok) {
      setTestUI(true);
      toast(testToast, `Thrust test started → ${pct}% (step ${step_s}s, ramp ${ramp_s}s)`);

      // Poll until done
      statusTimer = setInterval(async () => {
        try {
          const s = await (await fetch('/api/test_status', {cache:'no-store'})).json();
          if (!s.running && s.done) {
            clearInterval(statusTimer); statusTimer = null;
            setTestUI(false);                // re-enable Arm & Start buttons
            // backend auto-disarms at end; reflect that in UI
            if (isArmed) setArmUI(false);
            if (s.aborted) {
              toast(testToast, 'Thrust test STOPPED. No data saved.');
            } else {
              const where = (s.saved && s.logfile) ? ` CSV: ${s.logfile}` : (s.sd === false ? ' (SD not available)' : '');
              const escTxt = (typeof s.esc_reco === 'number' && s.esc_reco > 0)
                ? `  ESC≈${s.esc_reco.toFixed(1)}A (Imax ${s.i_max?.toFixed?.(2)}A)`
                : '';
              toast(testToast, `Thrust test complete (samples: ${s.samples}).${where}${escTxt}`);
            }
          }
        } catch {}
      }, 500);
    } else {
      // If backend returned "armed", it will no longer happen because backend auto-disarms at start.
      toast(testToast, j.err || 'Could not start test');
    }
  } catch {
    toast(testToast, 'Network error');
  }
}

async function stopThrustTest() {
  // Temporarily prevent double-click spamming
  const old = startBtn.textContent;
  startBtn.textContent = 'Stopping...';
  startBtn.disabled = true;
  try {
    const r = await fetch('/api/stop_thrust_test', { method: 'POST' });
    const j = await r.json();
    if (j.ok) {
      toast(testToast, 'Stopping test…');
      // we keep polling /api/test_status; UI will flip back when done
    } else {
      toast(testToast, j.err || 'Could not stop test');
    }
  } catch {
    toast(testToast, 'Network error');
  } finally {
    // Re-enable the button while we wait for status to turn done=false
    startBtn.disabled = false;
    startBtn.textContent = 'Stop Test';
  }
}



startBtn.addEventListener('click', () => {
  if (testRunning) stopThrustTest();
  else startThrustTest();
});
// Initialize consistent states on load
setArmUI(false);
setTestUI(false);

// ===== Editable project meta =====
const metaView     = document.getElementById('meta-view');
const metaEditWrap = document.getElementById('meta-editing');
const metaEditBtn  = document.getElementById('meta-edit');
const metaSaveBtn  = document.getElementById('meta-save');
const metaCancelBtn= document.getElementById('meta-cancel');
const metaToast    = document.getElementById('meta-toast');

const mBrand = document.getElementById('m-brand');
const mMotor = document.getElementById('m-motor');
const mKV    = document.getElementById('m-kv');
const mProp  = document.getElementById('m-prop');
const mDesc  = document.getElementById('m-desc');

const miBrand = document.getElementById('mi-brand');
const miMotor = document.getElementById('mi-motor');
const miKV    = document.getElementById('mi-kv');
const miProp  = document.getElementById('mi-prop');
const miDesc  = document.getElementById('mi-desc');

function showMetaToast(msg){ toast(metaToast, msg); }

function populateMetaView(meta){
  const orDash = v => (v && v.trim().length ? v : '—');
  mBrand.textContent = orDash(meta.brand);
  mMotor.textContent = orDash(meta.motor);
  mKV.textContent    = orDash(meta.kv);
  mProp.textContent  = orDash(meta.prop);
  mDesc.textContent  = orDash(meta.desc);
}

function populateMetaInputs(meta){
  miBrand.value = meta.brand || '';
  miMotor.value = meta.motor || '';
  miKV.value    = meta.kv    || '';
  miProp.value  = meta.prop  || '';
  miDesc.value  = meta.desc  || '';
}

function enterMetaEdit(){
  // seed inputs from current view (or last loaded meta)
  populateMetaInputs({
    brand: mBrand.textContent === '—' ? '' : mBrand.textContent,
    motor: mMotor.textContent === '—' ? '' : mMotor.textContent,
    kv:    mKV.textContent    === '—' ? '' : mKV.textContent,
    prop:  mProp.textContent  === '—' ? '' : mProp.textContent,
    desc:  mDesc.textContent  === '—' ? '' : mDesc.textContent,
  });
  metaView.hidden = true;
  metaEditWrap.hidden = false;
}

function exitMetaEdit(){
  metaEditWrap.hidden = true;
  metaView.hidden = false;
}

async function fetchMeta(){
  try{
    const r = await fetch('/api/meta', {cache:'no-store'});
    const j = await r.json();
    populateMetaView(j);
  }catch(e){}
}

async function saveMeta(){
  const body = new URLSearchParams({
    brand: miBrand.value,
    motor: miMotor.value,
    kv:    miKV.value,
    prop:  miProp.value,
    desc:  miDesc.value
  });
  try{
    const r = await fetch('/api/meta', { method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'}, body });
    const j = await r.json();
    if (j.ok) {
      populateMetaView(j.saved || {}); // server echoes "saved"
      showMetaToast('Saved ✔');
      exitMetaEdit();
    } else {
      showMetaToast(j.err || 'Save failed');
    }
  }catch(e){ showMetaToast('Network error'); }
}

// wire buttons
metaEditBtn.addEventListener('click', enterMetaEdit);
metaCancelBtn.addEventListener('click', exitMetaEdit);
metaSaveBtn.addEventListener('click', saveMeta);

// load meta on page load
fetchMeta();


// ===================== Analysis =====================
const listView = document.getElementById('analysis-list-view');
const viewer   = document.getElementById('analysis-viewer');
const listEl   = document.getElementById('log-list');
const listToast= document.getElementById('log-list-toast');
const backBtn  = document.getElementById('an-back');
const dlA      = document.getElementById('an-download');
const anTitle  = document.getElementById('an-title');

const COLS = [
  {key:'TIME', label:'Time (s)'},
  {key:'THROTTLE', label:'Throttle (%)'},
  {key:'VOLTAGE', label:'Voltage (V)'},
  {key:'CURRENT', label:'Current (A)'},
  {key:'KG', label:'Thrust (kg)'},
  {key:'POWER', label:'Power (W)'},
  {key:'EFFICIENCY', label:'Efficiency (kg/W)'}
];
const KEY2LABEL = Object.fromEntries(COLS.map(c=>[c.key,c.label]));

let anLogs = [];
let anData = null;   // parsed: {TIME:[], THROTTLE:[], ...}
let anFile = null;   // {path,name}
let anCfg  = null;   // {graphs:[{x,y}...]}

function toastList(msg){ toast(listToast, msg); }

async function initAnalysis(){
  await loadAnalysisPref();
  await refreshLogList();
}

async function refreshLogList(){
  try{
    const r = await fetch('/api/logs',{cache:'no-store'});
    const j = await r.json();
    if (!j.sd) { listEl.innerHTML = '<div class="muted">SD not available</div>'; return; }
    anLogs = j.files || [];
    if (!anLogs.length) { listEl.innerHTML = '<div class="muted">No logs found in /logs</div>'; return; }
    // most-recent-looking first (names include millis)
    anLogs.sort((a,b)=> (a.name < b.name ? 1 : -1));
    listEl.innerHTML = '';
    anLogs.forEach(f=>{
      const div = document.createElement('div'); div.className='log-item';
      div.innerHTML = `<div class="name">${f.name}</div><div class="meta">${(f.size/1024).toFixed(1)} kB</div>`;
      div.addEventListener('click', ()=> openLog(f));
      listEl.appendChild(div);
    });
    showList();
  }catch(e){ toastList('Failed to list logs'); }
}

function showList(){ listView.style.display='grid'; viewer.style.display='none'; }
function showViewer(){ listView.style.display='none'; viewer.style.display='grid'; }

// --- CSV parse (expects: meta, blank line, header row, data rows) ---
function parseCSV(text){
  const lines = text.replace(/\r/g,'').split('\n');

  // Find table header line (TIME,...)
  let headerIdx = lines.findIndex(ln => ln.trim().toUpperCase().startsWith('TIME,'));
  if (headerIdx < 0) {
    headerIdx = lines.findIndex(ln => ln.includes(',') && /TIME/i.test(ln));
    if (headerIdx < 0) throw new Error('No header found');
  }

  // ---- Parse meta preface (everything before header) ----
  const meta = { brand:'', motor:'', kv:'', prop:'', desc:'', i_max: NaN, esc: NaN };
  let inDesc = false;
  for (let i=0; i<headerIdx; i++){
    const raw = lines[i].trim();
    if (!raw && inDesc) { inDesc = false; continue; } // blank line ends description
    const upper = raw.toUpperCase();

    // Keys like "MOTOR BRAND:,T-Motor"
    if (upper.startsWith('MOTOR BRAND:')) {
      meta.brand = raw.split(':')[1]?.replace(/^,?/, '').trim() || meta.brand;
      inDesc = false;
    } else if (upper.startsWith('MOTOR:')) {
      meta.motor = raw.split(':')[1]?.replace(/^,?/, '').trim() || meta.motor;
      inDesc = false;
    } else if (upper.startsWith('KV:')) {
      meta.kv = raw.split(':')[1]?.replace(/^,?/, '').trim() || meta.kv;
      inDesc = false;
    } else if (upper.startsWith('PROPELLER:')) {
      meta.prop = raw.split(':')[1]?.replace(/^,?/, '').trim() || meta.prop;
      inDesc = false;
    } else if (upper.startsWith('DESCRIPTION:')) {
      // Description may span multiple lines after this
      const first = raw.substring(raw.indexOf(':')+1).replace(/^,?/, '');
      meta.desc = first.length ? first : '';
      inDesc = true;
    } else if (inDesc) {
      meta.desc += (meta.desc ? '\n' : '') + raw;
    } else if (upper.startsWith('PEAK_CURRENT_A:')) {
      const v = parseFloat(raw.split(':')[1]?.replace(/^,?/, '') || '');
      if (isFinite(v)) meta.i_max = v;
    } else if (upper.startsWith('RECOMMENDED_ESC_A:')) {
      const v = parseFloat(raw.split(':')[1]?.replace(/^,?/, '') || '');
      if (isFinite(v)) meta.esc = v;
    }
  }

  // ---- Parse table ----
  const header = lines[headerIdx].split(',').map(s=>s.trim().toUpperCase());
  const idx = {};
  ['TIME','THROTTLE','VOLTAGE','CURRENT','KG','POWER','EFFICIENCY'].forEach(k=>{
    idx[k] = header.indexOf(k);
  });

  const data = { TIME:[], THROTTLE:[], VOLTAGE:[], CURRENT:[], KG:[], POWER:[], EFFICIENCY:[] };
  for (let i=headerIdx+1; i<lines.length; i++){
    const ln = lines[i].trim();
    if (!ln) continue;
    const cells = ln.split(',');
    const get = (k)=> {
      const j = idx[k];
      if (j<0 || j>=cells.length) return NaN;
      return parseFloat(cells[j]);
    };
    data.TIME.push(get('TIME'));
    data.THROTTLE.push(get('THROTTLE'));
    data.VOLTAGE.push(get('VOLTAGE'));
    data.CURRENT.push(get('CURRENT'));
    data.KG.push(get('KG'));
    data.POWER.push(get('POWER'));
    data.EFFICIENCY.push(get('EFFICIENCY'));
  }

  // Fallback: compute ESC from data if not present in preface
  if (!isFinite(meta.esc)) {
    const maxI = data.CURRENT.reduce((m,v)=> (isFinite(v)&&v>m)?v:m, -Infinity);
    if (isFinite(maxI) && maxI>-Infinity) {
      meta.i_max = isFinite(meta.i_max) ? meta.i_max : maxI;
      meta.esc   = maxI * 1.5;
    }
  }

  return { meta, data };
}

function setMetaView(meta){
  const dash = s => (s && String(s).trim().length ? s : '—');
  anBrandEl.textContent = dash(meta.brand);
  anMotorEl.textContent = dash(meta.motor);
  anKVEl.textContent    = dash(meta.kv);
  anPropEl.textContent  = dash(meta.prop);
  anESCEl.textContent   = isFinite(meta.esc) ? `${meta.esc.toFixed(1)} A` : '—';
  anDescEl.textContent  = dash(meta.desc);
}


// --- Simple 2D chart with hover ---
class Chart2D {
  constructor(canvas, tipEl){
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.tip = tipEl;
    this.grid = {left:46,right:12,top:8,bottom:26};
    this.points = []; // [{x,y}]
    this.xlab='X'; this.ylab='Y';
    const resize = () => {
      const dpr = window.devicePixelRatio||1;
      this.c.width = Math.floor(this.c.clientWidth*dpr);
      this.c.height= Math.floor(this.c.clientHeight*dpr);
      this.ctx.setTransform(dpr,0,0,dpr,0,0);
      this.draw();
    };
    new ResizeObserver(resize).observe(this.c); resize();
    this.c.addEventListener('mousemove', (e)=> this.onMove(e));
    this.c.addEventListener('mouseleave', ()=> this.tip.style.display='none');
  }
  setData(xs, ys, xlab, ylab){
    this.points.length = 0;
    for (let i=0;i<xs.length && i<ys.length;i++){
      const x = xs[i], y = ys[i];
      if (isFinite(x) && isFinite(y)) this.points.push({x,y});
    }
    this.xlab = xlab; this.ylab = ylab;
    this.draw();
  }
  _range(){
    if (!this.points.length) return {xmin:0,xmax:1,ymin:0,ymax:1};
    let xmin=+Infinity,xmax=-Infinity,ymin=+Infinity,ymax=-Infinity;
    for (const p of this.points){
      if (p.x<xmin) xmin=p.x; if (p.x>xmax) xmax=p.x;
      if (p.y<ymin) ymin=p.y; if (p.y>ymax) ymax=p.y;
    }
    if (xmin===xmax){ xmin-=1; xmax+=1; }
    if (ymin===ymax){ ymin-=1; ymax+=1; }
    // padding
    const xpad=(xmax-xmin)*0.05, ypad=(ymax-ymin)*0.15;
    return {xmin:xmin-xpad, xmax:xmax+xpad, ymin:ymin-ypad, ymax:ymax+ypad};
  }
  draw(){
    const ctx=this.ctx,W=this.c.clientWidth,H=this.c.clientHeight,g=this.grid;
    ctx.clearRect(0,0,W,H);
    // frame
    ctx.strokeStyle='#243042'; ctx.strokeRect(g.left,g.top,W-g.left-g.right,H-g.top-g.bottom);
    const {xmin,xmax,ymin,ymax}=this._range();
    // axes ticks
    ctx.fillStyle='#8fa1b3'; ctx.font='12px system-ui,sans-serif';
    const xticks=4, yticks=4;
    for(let i=0;i<=xticks;i++){
      const xv=xmin+(i*(xmax-xmin)/xticks);
      const x=g.left + (i*(W-g.left-g.right)/xticks);
      ctx.globalAlpha=0.2; ctx.beginPath(); ctx.moveTo(x,g.top); ctx.lineTo(x,H-g.bottom); ctx.stroke();
      ctx.globalAlpha=1; ctx.fillText(xv.toFixed(2), x-10, H-6);
    }
    for(let i=0;i<=yticks;i++){
      const yv=ymin+(i*(ymax-ymin)/yticks);
      const y=g.top + (H-g.top-g.bottom) - (i*(H-g.top-g.bottom)/yticks);
      ctx.globalAlpha=0.2; ctx.beginPath(); ctx.moveTo(g.left,y); ctx.lineTo(W-g.right,y); ctx.stroke();
      ctx.globalAlpha=1; ctx.fillText(yv.toFixed(2), 4, y+4);
    }
    // line
    if (this.points.length>=2){
      ctx.strokeStyle='#5dd0ff'; ctx.lineWidth=2; ctx.beginPath();
      for (let i=0;i<this.points.length;i++){
        const p=this.points[i];
        const x=g.left + ((p.x-xmin)/(xmax-xmin))*(W-g.left-g.right);
        const y=g.top + (H-g.top-g.bottom) - ((p.y-ymin)/(ymax-ymin))*(H-g.top-g.bottom);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
    // labels
    ctx.fillStyle='#9db1c2'; ctx.fillText(this.xlab, W-80, H-6);
    ctx.save(); ctx.translate(10, 20); ctx.rotate(-Math.PI/2);
    ctx.fillText(this.ylab, 0, 0); ctx.restore();
  }
  onMove(e){
    if (!this.points.length) return;
    const rect=this.c.getBoundingClientRect(); const px=e.clientX-rect.left, py=e.clientY-rect.top;
    const W=this.c.clientWidth,H=this.c.clientHeight,g=this.grid;
    const {xmin,xmax,ymin,ymax}=this._range();
    let best=null,bd=1e9;
    for (let i=0;i<this.points.length;i++){
      const p=this.points[i];
      const x=g.left + ((p.x-xmin)/(xmax-xmin))*(W-g.left-g.right);
      const y=g.top + (H-g.top-g.bottom) - ((p.y-ymin)/(ymax-ymin))*(H-g.top-g.bottom);
      const d=(x-px)*(x-px)+(y-py)*(y-py);
      if (d<bd){ bd=d; best={x,y,px:p.x,py:p.y}; }
    }
    if (best){
      this.tip.style.left = (best.x)+'px';
      this.tip.style.top  = (best.y)+'px';
      this.tip.textContent = `${this.xlab}: ${best.px.toFixed(3)}  |  ${this.ylab}: ${best.py.toFixed(3)}`;
      this.tip.style.display='block';
    }
  }
}

const gCanvases = [0,1,2,3].map(i=>document.getElementById('an-g'+i));
const gTips     = [0,1,2,3].map(i=>document.getElementById('an-tip'+i));
const gCharts   = gCanvases.map((c,i)=> new Chart2D(c,gTips[i]));
const selX      = Array.from(document.querySelectorAll('.sel-x'));
const selY      = Array.from(document.querySelectorAll('.sel-y'));

function fillSelects(){
  const opts = COLS.map(c=>`<option value="${c.key}">${c.label}</option>`).join('');
  selX.forEach(s=> s.innerHTML = opts);
  selY.forEach(s=> s.innerHTML = opts);
}

async function loadAnalysisPref(){
  try{
    const r = await fetch('/api/analysis_pref',{cache:'no-store'});
    anCfg = await r.json();
  }catch{ anCfg = JSON.parse(analysisDefaultText()); }
}

function analysisDefaultText(){
  return "{\"graphs\":[{\"x\":\"TIME\",\"y\":\"VOLTAGE\"},{\"x\":\"TIME\",\"y\":\"POWER\"},{\"x\":\"THROTTLE\",\"y\":\"KG\"},{\"x\":\"TIME\",\"y\":\"EFFICIENCY\"}]}";
}

function applyCfgToSelects(){
  const cfg = (anCfg && anCfg.graphs && anCfg.graphs.length===4) ? anCfg : JSON.parse(analysisDefaultText());
  cfg.graphs.forEach((g,i)=>{
    const sx = selX.find(s=> s.dataset.idx===String(i));
    const sy = selY.find(s=> s.dataset.idx===String(i));
    if (sx && sy){ sx.value = g.x; sy.value = g.y; }
  });
}

let saveCfgTimer=null;
function saveCfgDebounced(){
  clearTimeout(saveCfgTimer);
  saveCfgTimer = setTimeout(async ()=>{
    const graphs = [0,1,2,3].map(i=>{
      const sx = selX.find(s=> s.dataset.idx===String(i));
      const sy = selY.find(s=> s.dataset.idx===String(i));
      return {x:sx.value, y:sy.value};
    });
    try{
      await fetch('/api/analysis_pref', {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body: new URLSearchParams({ cfg: JSON.stringify({graphs}) })
      });
    }catch{}
  }, 400);
}

selX.forEach(s=> s.addEventListener('change', ()=>{ updateAllCharts(); saveCfgDebounced(); }));
selY.forEach(s=> s.addEventListener('change', ()=>{ updateAllCharts(); saveCfgDebounced(); }));

function updateAllCharts(){
  if (!anData) return;
  for (let i=0;i<4;i++){
    const sx = selX.find(s=> s.dataset.idx===String(i));
    const sy = selY.find(s=> s.dataset.idx===String(i));
    const xk = sx.value, yk = sy.value;
    gCharts[i].setData(anData[xk]||[], anData[yk]||[], KEY2LABEL[xk], KEY2LABEL[yk]);
  }
}

async function openLog(f){
  anFile = f;
  anTitle.textContent = f.name;
  dlA.href = `/api/log_download?file=${encodeURIComponent(f.path)}`;
  showViewer();
  fillSelects(); applyCfgToSelects();
  try{
    const r = await fetch(`/api/log_download?file=${encodeURIComponent(f.path)}`, {cache:'no-store'});
    const txt = await r.text();
    const parsed = parseCSV(txt);
    anData = parsed.data;
    setMetaView(parsed.meta);
    updateAllCharts();
  }catch(e){
    toastList('Failed to load CSV');
    showList();
  }
}

backBtn.addEventListener('click', showList);

// Fill selects once
fillSelects();
