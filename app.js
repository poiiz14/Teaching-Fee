/* ===== CONFIG ===== */
let SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzMGjojLLQ40BxjFEluHe9WBj7W4_VDle4gAvoTK6esDs0-jIsbUl9O_0AOfoxfcrapZg/exec'; // ใส่ URL Apps Script ของปอย
const hashApi = new URLSearchParams(location.hash.replace('#','')).get('api');
if (hashApi) SCRIPT_URL = hashApi;

/* ปีงบประมาณไทย (>= 2568) */
function guessFiscalYearTH(){
  const d = new Date(), be = d.getFullYear()+543, m=d.getMonth();
  return Math.max((m>=9?be+1:be), 2568);
}
const defaultFY = guessFiscalYearTH();
let FY_LIST = JSON.parse(localStorage.getItem('fyList')||'[]');
if (!FY_LIST.length) { const maxFY = Math.max(defaultFY, 2569); for(let y=2568;y<=maxFY;y++) FY_LIST.push(String(y)); }
let currentFY = localStorage.getItem('currentFY') || String(defaultFY);

/* ===== User Email (สำหรับสิทธิ์) ===== */
function getUserEmail(){ return localStorage.getItem('userEmail') || ''; }
function setUserEmail(v){ localStorage.setItem('userEmail', (v||'').trim()); }

/* ===== JSONP helper ===== */
function jsonp(params){
  return new Promise((resolve,reject)=>{
    if(!SCRIPT_URL){ reject(new Error('SCRIPT_URL is empty')); return; }
    const cb='cb_'+Math.random().toString(36).slice(2);
    params.callback = cb;
    // แนบอีเมลผู้ใช้ทุกครั้ง (ถ้ามี)
    const email = getUserEmail();
    if (email && !params.email) params.email = email;

    const s=document.createElement('script');
    s.src = SCRIPT_URL + '?' + new URLSearchParams(params).toString();
    window[cb]=(data)=>{ delete window[cb]; s.remove();
      if (data && data.result === 'success') resolve(data);
      else reject(new Error((data && data.error) || 'Unknown error'));
    };
    s.onerror=()=>{ delete window[cb]; s.remove(); reject(new Error('Network error')); };
    document.body.appendChild(s);
  });
}

/* ===== Targets (Server-backed + Permission & Locks) ===== */
let TARGETS_CACHE = {};           // { '2568': { 'หมวด':จำนวน, ... } }
let TARGET_LOCKS  = {};           // { '2568': { 'หมวด': true, ... } }
let CAN_EDIT_TARGETS = false;     // สิทธิ์ของผู้ใช้ปัจจุบัน

async function loadTargetsToCache(fy){
  const res = await jsonp({ action:'getTargets', fy });
  TARGETS_CACHE[fy] = {};
  (res.items||[]).forEach(it => { TARGETS_CACHE[fy][it.category] = Number(it.target||0); });
  TARGET_LOCKS[fy] = res.locks || {};
  CAN_EDIT_TARGETS = !!res.canEdit;
  renderTargetsUI();
  renderSummary();
}

async function upsertTargetServer(fy, category, amount){
  const res = await jsonp({ action:'upsertTarget', fy, category, target: amount });
  TARGETS_CACHE[fy] = {};
  (res.items||[]).forEach(it => { TARGETS_CACHE[fy][it.category] = Number(it.target||0); });
  await loadTargetsToCache(fy);
}

async function deleteTargetServer(fy, category){
  const res = await jsonp({ action:'deleteTarget', fy, category });
  TARGETS_CACHE[fy] = {};
  (res.items||[]).forEach(it => { TARGETS_CACHE[fy][it.category] = Number(it.target||0); });
  await loadTargetsToCache(fy);
}

/* ====== UI: Targets ====== */
function renderTargetsUI(){
  const box = document.getElementById('budgetTargetsList');
  if(!box) return;

  const t = TARGETS_CACHE[currentFY] || {};
  const locks = TARGET_LOCKS[currentFY] || {};
  const cats = Object.keys(t).sort();

  const head = CAN_EDIT_TARGETS ? '' : '<div class="mb-2 text-xs text-rose-600">คุณมีสิทธิ์ “ดูอย่างเดียว” ไม่สามารถแก้ไขยอดตั้งต้นได้</div>';
  box.innerHTML = (cats.length? head : head + '<div class="text-slate-500">ยังไม่มียอดตั้งต้นของปีนี้</div>');

  cats.forEach(cat=>{
    const locked = !!locks[cat];
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3';
    row.innerHTML = `
      <div class="flex-1">
        ${cat}
        ${locked ? '<span class="ml-2 text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded">ล็อก</span>' : ''}
      </div>
      <input type="number" class="w-40 px-2 py-1 border rounded" value="${t[cat]}" data-cat="${cat}" ${(!CAN_EDIT_TARGETS||locked)?'disabled':''}>
      <button class="px-3 py-1 rounded bg-red-100 text-red-600 text-xs" data-del="${cat}" ${(!CAN_EDIT_TARGETS||locked)?'disabled':''}>ลบ</button>
    `;
    box.appendChild(row);
  });

  // events
  box.querySelectorAll('input[type="number"]').forEach(inp=>{
    inp.addEventListener('change', async ()=>{
      const cat = inp.dataset.cat;
      await upsertTargetServer(currentFY, cat, Number(inp.value||0));
    });
  });
  box.querySelectorAll('button[data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const cat = btn.dataset.del;
      await deleteTargetServer(currentFY, cat);
    });
  });

  // ปุ่มเพิ่มหมวดใหม่
  const addBtn = document.getElementById('addTargetBtn');
  if (addBtn) addBtn.disabled = !CAN_EDIT_TARGETS;
}

function bindTargetCreator(){
  const addBtn = document.getElementById('addTargetBtn');
  if(!addBtn) return;
  addBtn.addEventListener('click', async ()=>{
    if (!CAN_EDIT_TARGETS) { alert('คุณไม่มีสิทธิ์แก้ไขยอดตั้งต้น'); return; }
    const cat = document.getElementById('newTargetCategory').value.trim();
    const amt = Number(document.getElementById('newTargetAmount').value || 0);
    if (!cat) { alert('กรอกชื่อหมวดเงินก่อน'); return; }
    await upsertTargetServer(currentFY, cat, amt);
    document.getElementById('newTargetCategory').value='';
    document.getElementById('newTargetAmount').value='';
  });
}

/* ====== Email UI ====== */
function bindEmailBox(){
  const box = document.getElementById('userEmail');
  const btn = document.getElementById('saveEmailBtn');
  if (box) box.value = getUserEmail();
  if (btn) btn.addEventListener('click', async ()=>{
    setUserEmail((box.value||'').trim());
    // reload targets with new identity
    await loadTargetsToCache(currentFY);
    alert('บันทึกอีเมลแล้ว');
  });
}

/* ====== CRUD/ตาราง/สรุป (ตามเวอร์ชันล่าสุดของปอย) ====== */
const statusOptions = [
  { value: 'pending',    label:'ส่งงานวิชาการแล้ว',      class:'status-pending' },
  { value: 'processing', label:'อยู่ระหว่างส่งงานการเงินตรวจ', class:'status-processing' },
  { value: 'revision',   label:'ส่งกลับแก้ไข',             class:'status-revision' },
  { value: 'recheck',    label:'ส่งตรวจอีกครั้ง',           class:'status-recheck' },
  { value: 'finance',    label:'ส่งเบิกที่การเงินแล้ว',      class:'status-finance' },
  { value: 'completed',  label:'ตัดจ่ายเงินแล้ว',           class:'status-completed' }
];

let allRecords=[], filteredRecords=[], chartInstance=null;

document.addEventListener('DOMContentLoaded', async ()=>{
  renderFYTabs(); setBudgetYearInput(); prefillDefaults();
  attachEvents(); bindTargetCreator(); bindEmailBox();
  try { await loadRecords(); await loadTargetsToCache(currentFY); } catch(e){}
});

function attachEvents(){
  const f1=document.getElementById('recordForm'); if(f1) f1.addEventListener('submit', onSubmit);
  const f2=document.getElementById('editForm');   if(f2) f2.addEventListener('submit', onEditSubmit);
  const addFY=document.getElementById('addFYBtn'); if(addFY) addFY.addEventListener('click', onAddFY);
}

function renderFYTabs(){
  const wrap=document.getElementById('fyTabs'), label=document.getElementById('currentFYLabel');
  if(!wrap) return; wrap.innerHTML='';
  FY_LIST.forEach(fy=>{
    const b=document.createElement('button');
    b.className='fy-tab'+(fy===currentFY?' active':''); b.dataset.fy=fy; b.textContent=fy;
    b.addEventListener('click', async ()=>{
      if(currentFY===fy) return;
      currentFY=fy; localStorage.setItem('currentFY', currentFY);
      setBudgetYearInput(); renderFYTabs();
      await loadRecords(); await loadTargetsToCache(currentFY);
    });
    wrap.appendChild(b);
  });
  if(label) label.textContent=currentFY;
}

function onAddFY(){
  const v = prompt('เพิ่มปีงบประมาณ (ตั้งแต่ 2568 ขึ้นไป):', String(Number(FY_LIST[FY_LIST.length-1]||currentFY)+1));
  const n = Number(v||'');
  if(!n || n<2568) return;
  const fy=String(n);
  if(!FY_LIST.includes(fy)){ FY_LIST.push(fy); FY_LIST.sort(); localStorage.setItem('fyList', JSON.stringify(FY_LIST)); }
  currentFY=fy; localStorage.setItem('currentFY', currentFY);
  setBudgetYearInput(); renderFYTabs();
  loadRecords(); loadTargetsToCache(currentFY);
}

/* ====== ตัวอย่างโหลดข้อมูล/เรนเดอร์ (คง logic เดิม) ====== */
async function loadRecords(){
  const res = await jsonp({ action:'get', sheet: currentFY });
  allRecords = Array.isArray(res.data)?res.data:[];
  filteredRecords = allRecords.filter(r => String(r.budgetYear||'') === String(currentFY));
  renderTable(); renderSummary();
}

async function onSubmit(e){
  e.preventDefault();
  const record = {
    subject:v('subject'), teacher:v('teacher'), semester:v('semester'),
    academicYear:v('academicYear'), budgetYear:currentFY,
    category:v('category'), amount:parseFloat(v('amount'))||0,
    month:v('month'), note:v('note'), status:'pending'
  };
  try{
    await jsonp({ action:'add', sheet: currentFY, ...record });
    e.target.reset(); prefillDefaults(); setBudgetYearInput(); await loadRecords();
  }catch(err){ alert('บันทึกไม่สำเร็จ: '+err.message); }
}

async function changeStatus(id,newStatus){
  try{
    await jsonp({ action:'update', sheet: currentFY, id, status:newStatus });
    const rec = allRecords.find(r=>r.id===id); if(rec) rec.status=newStatus;
    filteredRecords = allRecords.filter(r => String(r.budgetYear||'') === String(currentFY));
    renderTable(); renderSummary();
  }catch(err){ alert('อัปเดตไม่สำเร็จ: '+err.message); }
}
async function removeRecord(id){
  if(!confirm('ลบรายการนี้?')) return;
  try{
    await jsonp({ action:'delete', sheet: currentFY, id });
    allRecords = allRecords.filter(r=>r.id!==id);
    filteredRecords = allRecords.filter(r => String(r.budgetYear||'') === String(currentFY));
    renderTable(); renderSummary();
  }catch(err){ alert('ลบไม่สำเร็จ: '+err.message); }
}

function openEditModal(id){ /* ... ของเดิม ... */ }
function closeEditModal(){ document.getElementById('editModal')?.classList.add('hidden'); }
async function onEditSubmit(e){ /* ... ของเดิม ... */ }

/* ====== Summary + Chart ====== */
function renderSummary(){
  const total = (filteredRecords||[]).reduce((s,r)=> s+(Number(r.amount)||0),0);
  const done  = (filteredRecords||[]).filter(r=>r.status==='completed').length;
  g('totalAmount').textContent = total.toLocaleString()+' บาท';
  g('totalRecords').textContent = (filteredRecords||[]).length+' รายการ';
  g('completedRecords').textContent = done+' รายการ';

  const catSum={};
  (filteredRecords||[]).forEach(r=>{
    const c=r.category||'ไม่ระบุ'; const a=Number(r.amount)||0;
    catSum[c]=(catSum[c]||0)+a;
  });
  g('categorySummary').innerHTML = Object.keys(catSum).length
    ? Object.entries(catSum).map(([c,a])=>`• ${c}: ${a.toLocaleString()} บาท`).join('<br>')
    : '- ยังไม่มีข้อมูล -';

  const targets = TARGETS_CACHE[currentFY] || {};
  const labels=[], used=[], tvals=[], perc=[];
  Object.entries(catSum).forEach(([c,a])=>{
    const t=Number(targets[c]||0);
    labels.push(c); used.push(a); tvals.push(t); perc.push(t>0?(a/t*100):0);
  });
  drawChart(labels, used, tvals, perc);
}

function drawChart(labels, used, targets, perc){
  const el=document.getElementById('budgetChart'); if(!el) return;
  const ctx=el.getContext('2d'); if(chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[
      { label:'ใช้ไป (บาท)', data:used, backgroundColor:'#a78bfa' },
      { label:'ยอดตั้งต้น (บาท)', data:targets, backgroundColor:'#e9d5ff' }
    ]},
    options:{ responsive:true, plugins:{ tooltip:{ callbacks:{ afterBody:(items)=>{ const i=items[0].dataIndex; return 'ใช้ไป: '+Number(perc[i]).toFixed(2)+'%'; } } } }, scales:{ y:{ beginAtZero:true } } }
  });
}

/* ===== Utils ===== */
function g(id){ return document.getElementById(id); }
function v(id){ const el=g(id); return el?el.value.trim():''; }
function setBudgetYearInput(){ if(g('budgetYear')) g('budgetYear').value=currentFY; if(g('edit_budgetYear')) g('edit_budgetYear').value=currentFY; const l=g('currentFYLabel'); if(l) l.textContent=currentFY; }
function prefillDefaults(){ const n=new Date(), gy=n.getFullYear(), by=gy+543, m=n.getMonth()+1; const ay=(m>=8)?by:(by-1); if(g('academicYear')) g('academicYear').value=ay; const th=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']; if(g('month')) g('month').value=th[m-1]; }
function renderTable(){ /* ... ของเดิมที่ปอยใช้อยู่ (ไม่ตัดรายละเอียดเพื่อความสั้น) ... */ }

/* ปุ่มที่เรียกจาก HTML */
window.changeStatus=changeStatus; window.removeRecord=removeRecord;
