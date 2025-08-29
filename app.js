/* ===== CONFIG ===== */
console.log('app.js loaded');
let SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzMGjojLLQ40BxjFEluHe9WBj7W4_VDle4gAvoTK6esDs0-jIsbUl9O_0AOfoxfcrapZg/exec'; // ใส่ของปอย
const hashApi = new URLSearchParams(location.hash.replace('#','')).get('api');
if (hashApi) SCRIPT_URL = hashApi;

/* ปีงบประมาณ: เริ่ม 1 ต.ค. และไม่น้อยกว่า 2568 */
function guessFiscalYearTH() {
  const d = new Date();
  const be = d.getFullYear() + 543;
  const m = d.getMonth(); // 0-11
  const fy = (m >= 9) ? be + 1 : be; // ต.ค.(9) เป็นปีถัดไป
  return Math.max(fy, 2568);
}

/* รายการปีที่มีแท็บ (แก้/เพิ่มได้จาก UI, เก็บใน localStorage) */
const defaultFY = guessFiscalYearTH();
let FY_LIST = JSON.parse(localStorage.getItem('fyList') || '[]');
if (!FY_LIST.length) {
  // เริ่มจาก 2568 ... จนถึงปีปัจจุบัน (พร้อมปีถัดไป 1 ปีเพื่อเผื่อเริ่มงบ)
  const maxFY = Math.max(defaultFY, 2569);
  for (let y = 2568; y <= maxFY; y++) FY_LIST.push(String(y));
}
let currentFY = localStorage.getItem('currentFY') || String(defaultFY);

const statusOptions = [
  { value: 'pending',    label:'ส่งงานวิชาการแล้ว',      class:'status-pending' },
  { value: 'processing', label:'อยู่ระหว่างส่งงานการเงินตรวจ', class:'status-processing' },
  { value: 'revision',   label:'ส่งกลับแก้ไข',             class:'status-revision' },
  { value: 'recheck',    label:'ส่งตรวจอีกครั้ง',           class:'status-recheck' },
  { value: 'finance',    label:'ส่งเบิกที่การเงินแล้ว',      class:'status-finance' },
  { value: 'completed',  label:'ตัดจ่ายเงินแล้ว',           class:'status-completed' }
];

let allRecords = [], filteredRecords = [];

/* รอให้ DOM พร้อมก่อนแตะ element ใด ๆ */
document.addEventListener('DOMContentLoaded', async () => {
  const apiInfoEl = document.getElementById('apiInfo');
  if (apiInfoEl) apiInfoEl.textContent = 'API: ' + (SCRIPT_URL || 'ยังไม่ได้ตั้งค่า');

  renderFYTabs();          // (1) วาดแท็บ
  prefillDefaults();       // (5) ตั้งค่าดีฟอลต์ตามปฏิทินงบไทย
  attachEvents();

  try {
    await healthCheck();
    await loadRecords();   // (2)(3) โหลดเฉพาะชีท/ปีปัจจุบัน
  } catch(e) {
    // healthCheck จะฟ้องให้แล้ว
  }
});

function attachEvents() {
  const f1 = document.getElementById('recordForm');
  if (f1) f1.addEventListener('submit', onSubmit);
  const f2 = document.getElementById('editForm');
  if (f2) f2.addEventListener('submit', onEditSubmit);

  const addBtn = document.getElementById('addFYBtn');
  if (addBtn) addBtn.addEventListener('click', onAddFY);
}

/* ====== Tabs ====== */
function renderFYTabs() {
  const wrap = document.getElementById('fyTabs');
  const label = document.getElementById('currentFYLabel');
  if (!wrap) return;

  wrap.innerHTML = '';
  FY_LIST.forEach(fy => {
    const btn = document.createElement('button');
    btn.className = 'fy-tab' + (fy === currentFY ? ' active' : '');
    btn.dataset.fy = fy;
    btn.textContent = fy;
    btn.addEventListener('click', async () => {
      if (currentFY === fy) return;
      currentFY = fy;
      localStorage.setItem('currentFY', currentFY);
      setBudgetYearInput();        // อัปเดตช่องปีงบในฟอร์มให้ตรงแท็บ
      renderFYTabs();              // รีเฟรช active tab
      await loadRecords();         // โหลดข้อมูลปีนี้
    });
    wrap.appendChild(btn);
  });
  if (label) label.textContent = currentFY;
}

function onAddFY() {
  Swal.fire({
    title: 'เพิ่มปีงบประมาณ',
    input: 'number',
    inputLabel: 'ระบุปีงบฯ (เช่น 2569)',
    inputValue: Math.max(Number(FY_LIST[FY_LIST.length-1]||currentFY)+1, 2568),
    showCancelButton: true,
    confirmButtonText: 'เพิ่ม',
    cancelButtonText: 'ยกเลิก',
    inputValidator: (v) => {
      const n = Number(v);
      if (!n || n < 2568) return 'ปีงบฯ ต้องเป็นตัวเลขตั้งแต่ 2568 ขึ้นไป';
    }
  }).then(res => {
    if (!res.isConfirmed) return;
    const fy = String(res.value);
    if (!FY_LIST.includes(fy)) {
      FY_LIST.push(fy);
      FY_LIST.sort(); // เรียง
      localStorage.setItem('fyList', JSON.stringify(FY_LIST));
    }
    currentFY = fy;
    localStorage.setItem('currentFY', currentFY);
    setBudgetYearInput();
    renderFYTabs();
    loadRecords();
  });
}

/* ===== JSONP helper ===== */
function jsonp(params) {
  return new Promise((resolve, reject) => {
    if (!SCRIPT_URL || !/^https?:\/\//.test(SCRIPT_URL)) {
      reject(new Error('SCRIPT_URL ไม่ถูกต้อง')); return;
    }
    const cb = 'jsonp_cb_' + Math.random().toString(36).slice(2);
    params.callback = cb;
    const s = document.createElement('script');
    s.src = SCRIPT_URL + '?' + new URLSearchParams(params).toString();
    window[cb] = (data) => { delete window[cb]; s.remove();
      if (data && data.result === 'success') resolve(data);
      else reject(new Error((data && data.error) || 'Unknown error')); };
    s.onerror = () => { delete window[cb]; s.remove(); reject(new Error('Network error')); };
    document.body.appendChild(s);
  });
}

async function healthCheck(){
  try { await jsonp({action:'ping'}); return true; }
  catch {
    try { await jsonp({action:'get', sheet: currentFY}); return true; }
    catch(e){ Swal.fire({icon:'error',title:'เชื่อมต่อ API ไม่ได้', text:e.message||e}); throw e; }
  }
}

/* ===== CRUD (ผูกกับปี/ชีท) ===== */
async function loadRecords() {
  const res = await jsonp({ action:'get', sheet: currentFY });
  allRecords = Array.isArray(res.data) ? res.data : [];
  // ถ้า backend ส่งรวมหลายปีไว้ (เผื่อ) — กรองซ้ำอีกชั้น
  filteredRecords = allRecords.filter(r => String(r.budgetYear||'') === String(currentFY));
  renderTable(); 
  renderSummary(); // (3) ยอดรวมตามหมวดเงิน เฉพาะปีที่เลือก
}

async function onSubmit(e) {
  e.preventDefault();
  const record = {
    subject: v('subject'), teacher: v('teacher'), semester: v('semester'),
    academicYear: v('academicYear'), budgetYear: v('budgetYear'),
    category: v('category'), amount: parseFloat(v('amount'))||0,
    month: v('month'), note: v('note'), status:'pending'
  };
  // บังคับให้ budgetYear = แท็บปัจจุบัน เพื่อไม่ให้หลุดปี
  record.budgetYear = currentFY;
  setBudgetYearInput();

  Swal.fire({ title:'กำลังบันทึก...', allowOutsideClick:false, didOpen:() => Swal.showLoading() });
  try {
    await jsonp({ action:'add', sheet: currentFY, ...record }); // (2) ส่ง sheet ไป backend
    Swal.close();
    Swal.fire({ icon:'success', title:'บันทึกสำเร็จ', timer:1000, showConfirmButton:false });
    e.target.reset(); prefillDefaults(); setBudgetYearInput(); await loadRecords();
  } catch (err) {
    Swal.close(); Swal.fire({ icon:'error', title:'บันทึกไม่สำเร็จ', text:String(err) });
  }
}

async function changeStatus(id, newStatus) {
  try {
    await jsonp({ action:'update', sheet: currentFY, id, status:newStatus });
    const rec = allRecords.find(r => r.id === id); if (rec) rec.status = newStatus;
    filteredRecords = allRecords.filter(r => String(r.budgetYear||'') === String(currentFY));
    renderTable(); renderSummary();
    Swal.fire({ icon:'success', title:'อัปเดตสถานะแล้ว', timer:900, showConfirmButton:false });
  } catch (err) {
    Swal.fire({ icon:'error', title:'อัปเดตไม่สำเร็จ', text:String(err) });
  }
}

async function removeRecord(id) {
  const ok = await Swal.fire({ title:'ยืนยันการลบ?', icon:'warning', showCancelButton:true, confirmButtonText:'ลบ', cancelButtonText:'ยกเลิก', confirmButtonColor:'#ef4444' });
  if (!ok.isConfirmed) return;
  try {
    await jsonp({ action:'delete', sheet: currentFY, id });
    allRecords = allRecords.filter(r => r.id !== id);
    filteredRecords = allRecords.filter(r => String(r.budgetYear||'') === String(currentFY));
    renderTable(); renderSummary();
    Swal.fire({ icon:'success', title:'ลบสำเร็จ', timer:900, showConfirmButton:false });
  } catch (err) {
    Swal.fire({ icon:'error', title:'ลบไม่สำเร็จ', text:String(err) });
  }
}

/* ===== Edit (Modal) ===== */
function openEditModal(id){
  const r = allRecords.find(x => x.id === id);
  if (!r) return;
  g('edit_id').value = r.id;
  g('edit_subject').value = r.subject || '';
  g('edit_teacher').value = r.teacher || '';
  g('edit_semester').value = r.semester || 'ภาคการศึกษาที่ 1';
  g('edit_academicYear').value = r.academicYear || '';
  g('edit_budgetYear').value = currentFY; // ยึดตามแท็บ
  g('edit_category').value = r.category || '';
  g('edit_amount').value = r.amount || 0;
  g('edit_month').value = r.month || '';
  g('edit_note').value = r.note || '';
  g('editModal').classList.remove('hidden');
}
function closeEditModal(){ g('editModal').classList.add('hidden'); }

async function onEditSubmit(e){
  e.preventDefault();
  const id = g('edit_id').value;
  const payload = {
    id,
    subject: v('edit_subject'),
    teacher: v('edit_teacher'),
    semester: v('edit_semester'),
    academicYear: v('edit_academicYear'),
    budgetYear: currentFY, // ล็อกตามปีงบแท็บ
    category: v('edit_category'),
    amount: parseFloat(v('edit_amount'))||0,
    month: v('edit_month'),
    note: v('edit_note')
  };
  Swal.fire({ title:'กำลังบันทึกการแก้ไข...', allowOutsideClick:false, didOpen:() => Swal.showLoading() });
  try {
    await jsonp({ action:'update', sheet: currentFY, ...payload });
    const idx = allRecords.findIndex(r=>r.id===id);
    if (idx > -1) allRecords[idx] = { ...allRecords[idx], ...payload };
    filteredRecords = allRecords.filter(r => String(r.budgetYear||'') === String(currentFY));
    renderTable(); renderSummary(); closeEditModal();
    Swal.close(); Swal.fire({ icon:'success', title:'แก้ไขสำเร็จ', timer:900, showConfirmButton:false });
  } catch (err) {
    Swal.close(); Swal.fire({ icon:'error', title:'แก้ไขไม่สำเร็จ', text:String(err) });
  }
}

/* ===== Render ===== */
function renderSummary() {
  const total = (filteredRecords||[]).reduce((s,r)=> s + (Number(r.amount)||0), 0);
  const done = (filteredRecords||[]).filter(r=>r.status==='completed').length;

  g('totalAmount').textContent = total.toLocaleString() + ' บาท';
  g('totalRecords').textContent = (filteredRecords||[]).length + ' รายการ';
  g('completedRecords').textContent = done + ' รายการ';

  // --- คำนวณยอดรวมแยกตามหมวดเงิน (เฉพาะปีที่เลือก) ---
  const categoryTotals = {};
  (filteredRecords||[]).forEach(r => {
    const cat = r.category || 'ไม่ระบุ';
    const amt = Number(r.amount) || 0;
    categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
  });

  const lines = Object.entries(categoryTotals)
    .map(([cat, amt]) => `• ${cat}: ${amt.toLocaleString()} บาท`);

  g('categorySummary').innerHTML = lines.length ? lines.join('<br>') : '- ยังไม่มีข้อมูล -';
}

function renderTable() {
  const tb = g('recordsTable'); if (!tb) return; tb.innerHTML = '';
  (filteredRecords||[]).forEach((r,i) => {
    const opt = statusOptions.find(s => s.value===r.status) || statusOptions[0];
    const tr = document.createElement('tr');
    tr.className = 'border-b border-gray-100 hover:bg-purple-50 transition-colors';
    tr.innerHTML = `
      <td class="px-4 py-3 text-sm">${i+1}</td>
      <td class="px-4 py-3 text-sm font-medium">${esc(r.subject||'')}</td>
      <td class="px-4 py-3 text-sm">${esc(r.teacher||'')}</td>
      <td class="px-4 py-3 text-sm">${esc(r.semester||'')}</td>
      <td class="px-4 py-3 text-sm">${esc(r.academicYear||'')}</td>
      <td class="px-4 py-3 text-sm">${esc(r.category||'')}</td>
      <td class="px-4 py-3 text-sm">${esc(r.month||'')}</td>
      <td class="px-4 py-3 text-sm font-semibold text-green-600">${(Number(r.amount)||0).toLocaleString()} บาท</td>
      <td class="px-4 py-3 text-sm">${esc(r.note || '')}</td>
      <td class="px-4 py-3">
          <select class="status-pill ${opt.class}" onchange="changeStatus('${r.id}', this.value)">
          ${statusOptions.map(s=>`<option value="${s.value}" ${r.status===s.value?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </td>
      <td class="px-4 py-3 flex gap-2">
        <button class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded-lg text-xs font-medium" onclick="openEditModal('${r.id}')">✏️ แก้ไข</button>
        <button class="bg-red-100 hover:bg-red-200 text-red-600 px-3 py-1 rounded-lg text-xs font-medium" onclick="removeRecord('${r.id}')">🗑️ ลบ</button>
      </td>`;
    tb.appendChild(tr);
  });
}

/* ===== Utils ===== */
function g(id){ return document.getElementById(id); }
function v(id){ const el = g(id); return el ? el.value.trim() : ''; }
function esc(s){
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[m]));
}

function setBudgetYearInput() {
  if (g('budgetYear'))   g('budgetYear').value   = currentFY;
  if (g('edit_budgetYear')) g('edit_budgetYear').value = currentFY;
  const label = g('currentFYLabel'); if (label) label.textContent = currentFY;
}

function prefillDefaults() {
  const now = new Date(), gYear = now.getFullYear(), bYear = gYear + 543, m = now.getMonth()+1;
  const academicYear = (m >= 8) ? bYear : (bYear - 1); // ปีการศึกษาเริ่ม ส.ค./ก.ย. (ตามเดิม)
  if (g('academicYear')) g('academicYear').value = academicYear;
  setBudgetYearInput(); // ใช้ปีงบตามแท็บเสมอ
  const thMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  if (g('month')) g('month').value = thMonths[m-1];
}

function exportCSV() {
  const rows = [['ID','รายวิชา','อาจารย์','ภาคการศึกษา','ปีการศึกษา','ปีงบประมาณ','หมวดเงิน','เดือนที่เบิก','จำนวนเงิน','สถานะ','รายการ','วันที่บันทึก','รวมเป็นเงิน','ผู้บันทึก']];
  (filteredRecords||[]).forEach(r=>{
    rows.push([r.id,r.subject,r.teacher,r.semester,r.academicYear,r.budgetYear,r.category,r.month,r.amount,r.status,r.note,(r.timestamp?new Date(r.timestamp).toLocaleString('th-TH'):''),r.total,r.recorder]);
  });
  const csv = rows.map(a => a.map(x => `"${String(x ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `ค่าสอน_FY${currentFY}.csv`; a.click(); URL.revokeObjectURL(url);
}

/* เผยฟังก์ชันให้ปุ่มใน HTML เรียกได้ */
window.changeStatus = changeStatus;
window.removeRecord = removeRecord;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.exportCSV = exportCSV;
