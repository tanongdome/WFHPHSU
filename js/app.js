<script>
  /**
 * app.js — WFH System Main Application
 * ──────────────────────────────────────
 * จัดการ: state, routing, UI, form submission
 */

'use strict';

/* ════════════════════════════════════════
   STATE
   ════════════════════════════════════════ */
let currentUser   = null;
let sigPadIn      = null;
let sigPadOut     = null;
let ciGPS         = '';
let coGPS         = '';
let allReportData = [];
let currentRptPage = 1;
let _rptStats     = { ontime: 0, late: 0, early: 0 };
let attachments   = [];
let dailyPdfData  = [];

const RPT_PER_PAGE = 15;

/* ════════════════════════════════════════
   INIT
   ════════════════════════════════════════ */
window.addEventListener('load', async () => {
  // ฉีด viewport meta (ป้องกัน parent frame override)
  _injectViewport(document);
  try { if (window.parent !== window) _injectViewport(window.parent.document); } catch {}

  // เริ่มนาฬิกา
  _startClock();
  _updateDate();

  // ตั้งค่าเริ่มต้น input
  _q('#pdfDate').value = _todayISO();
  _q('#mrMonth').value = _todayYM();
  _q('#leaveYear').textContent = new Date().getFullYear();
  renderLeaveQuota([]);

  _q('#leaveStartDate').addEventListener('change', calcLeaveDays);
  _q('#leaveEndDate').addEventListener('change',   calcLeaveDays);

  // Camera module — setup callbacks
  Camera.onCapture = (slot) => {
    if (slot === 'in') setStep('ci', 2);
  };
  Camera.onRetake = (slot) => {
    if (slot === 'in') setStep('ci', 1);
  };
  Camera.init();

  // Session restore
  const saved = sessionStorage.getItem('wfhUser');
  if (saved) {
    currentUser = JSON.parse(saved);
    await showApp();
  } else {
    hide('appLoader');
    show('loginPage');
  }
});

function _injectViewport(doc) {
  if (!doc?.head) return;
  let m = doc.querySelector('meta[name="viewport"]');
  if (!m) { m = doc.createElement('meta'); m.name = 'viewport'; doc.head.appendChild(m); }
  m.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
}

/* ════════════════════════════════════════
   AUTH
   ════════════════════════════════════════ */
function switchAuthTab(tab) {
  _qa('.auth-tab').forEach((el, i) =>
    el.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'))
  );
  _q('#loginForm').classList.toggle('active', tab === 'login');
  _q('#registerForm').classList.toggle('active', tab === 'register');
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = _q('#loginBtn');
  _btnLoading(btn, 'กำลังเข้าสู่ระบบ...');
  try {
    const res = await API.auth.login({
      username: _val('loginUser'),
      password: _val('loginPass'),
    });
    if (res.success) {
      currentUser = res.user;
      sessionStorage.setItem('wfhUser', JSON.stringify(currentUser));
      await showApp();
    } else {
      toast(res.message || 'เข้าสู่ระบบไม่สำเร็จ', 'error');
    }
  } catch {
    toast('ไม่สามารถเชื่อมต่อระบบได้', 'error');
  } finally {
    _btnReset(btn, '<i class="fas fa-sign-in-alt"></i> เข้าสู่ระบบ');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const pass = _val('regPass'), pass2 = _val('regPass2');
  if (pass !== pass2)  { toast('รหัสผ่านไม่ตรงกัน', 'error');          return; }
  if (pass.length < 6) { toast('รหัสผ่านต้องมีอย่างน้อย 6 ตัว', 'error'); return; }
  const btn = _q('#registerBtn');
  _btnLoading(btn);
  try {
    const res = await API.auth.register({
      name: _val('regName'), email: _val('regEmail'), password: pass,
      dept: _val('regDept'), pos: _val('regPos'),
    });
    if (res.success) {
      await Swal.fire({ icon:'success', title:'ลงทะเบียนสำเร็จ!', text:'กรุณาเข้าสู่ระบบ', confirmButtonColor:'#26A69A' });
      switchAuthTab('login');
      _q('#loginUser').value = _val('regEmail');
    } else {
      toast(res.message, 'error');
    }
  } catch { toast('ไม่สามารถเชื่อมต่อ', 'error'); }
  finally  { _btnReset(btn, '<i class="fas fa-user-plus"></i> ลงทะเบียน'); }
}

async function handleForgotPassword() {
  const result = await Swal.fire({
    title: 'ลืมรหัสผ่าน', icon: 'question', showCancelButton: true,
    confirmButtonText: 'ส่งรหัสผ่าน', cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#26A69A', cancelButtonColor: '#90A4AE',
    html: '<input id="swal-email" class="swal2-input" type="email" placeholder="อีเมล" style="font-family:Sarabun,sans-serif">',
    preConfirm: () => {
      const v = document.getElementById('swal-email').value.trim();
      if (!v.includes('@')) { Swal.showValidationMessage('กรุณากรอกอีเมลให้ถูกต้อง'); return false; }
      return v;
    },
  });
  if (!result.value) return;
  Swal.fire({ title: 'กำลังส่ง...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  try {
    const res = await API.auth.forgot({ email: result.value });
    Swal.close();
    Swal.fire({ icon: res.success ? 'success' : 'error', title: res.success ? 'ส่งอีเมลแล้ว!' : 'เกิดข้อผิดพลาด', text: res.message, confirmButtonColor: '#26A69A' });
  } catch { Swal.close(); toast('เกิดข้อผิดพลาด', 'error'); }
}

/* ════════════════════════════════════════
   APP SHELL
   ════════════════════════════════════════ */
async function showApp() {
  hide('appLoader'); hide('loginPage');
  _q('#appLayout').style.display = 'flex';
  _q('#sidebarAvatar').textContent = (currentUser.name || 'U')[0].toUpperCase();
  _q('#sidebarName').textContent   = currentUser.name  || '';
  _q('#sidebarRole').textContent   = currentUser.role === 'admin' ? 'ADMIN' : 'EMPLOYEE';

  if (currentUser.role === 'admin') {
    _qa('.admin-only').forEach(el => el.style.display = '');
    _q('#navHistoryLabel').textContent = 'ประวัติการเข้างาน';
    _q('#histPageTitle').textContent   = 'ประวัติการเข้างาน';
    _q('#histPageSub').textContent     = 'ข้อมูลการลงเวลาของเจ้าหน้าที่ทุกคน';
    _q('#dashHistLabel').textContent   = 'ประวัติการเข้างาน';
    _q('#dashHistSub').textContent     = 'ดูข้อมูลทุกคน';
    _qa('.col-name,.col-dept').forEach(el => el.style.display = '');
    loadHistoryUsers();
  }

  setTimeout(() => { initSigPads(); getGPS('ci'); getGPS('co'); }, 400);
  await Promise.all([loadDashboard(), loadTodayStatus(), checkLeaveEnabled()]);
}

function logout() {
  sessionStorage.removeItem('wfhUser');
  currentUser = null;
  Camera.stopAll();
  API.clearAll();
  _q('#appLayout').style.display = 'none';
  show('loginPage');
  switchAuthTab('login');
  toast('ออกจากระบบสำเร็จ', 'info');
}

function toggleSidebar() { _q('#sidebar').classList.toggle('open'); _q('#sidebarOverlay').classList.toggle('show'); }
function closeSidebar()   { _q('#sidebar').classList.remove('open'); _q('#sidebarOverlay').classList.remove('show'); }

function switchPage(pid) {
  _qa('.page').forEach(p => p.classList.remove('active'));
  _qa('.nav-item').forEach(n => n.classList.remove('active'));
  const page = _q(`#page-${pid}`);
  if (page) page.classList.add('active');

  const titles = {
    dashboard: 'Dashboard', checkin: 'ลงเวลาเข้างาน', checkout: 'ลงเวลาออกงาน',
    history:   currentUser?.role === 'admin' ? 'ประวัติการเข้างาน' : 'ประวัติของฉัน',
    report: 'รายงานทั้งหมด', monthlyReport: 'รายงานรายเดือน', users: 'จัดการผู้ใช้', leave: 'ขอลาหยุด',
  };
  _q('#pageTitle').textContent = titles[pid] || pid;

  _qa('.nav-item').forEach(el => {
    if ((el.getAttribute('onclick') || '').includes(`'${pid}'`)) el.classList.add('active');
  });

  const actions = {
    history:      () => loadHistory(),
    report:       () => { loadReportUsers(); loadReport(); },
    users:        () => loadUsers(),
    leave:        () => loadLeaveHistory(),
    checkin:      () => setTimeout(resizeSigPads, 300),
    checkout:     () => setTimeout(resizeSigPads, 300),
  };
  actions[pid]?.();

  closeSidebar();
  window.scrollTo(0, 0);
}

function refreshPage() {
  const pid = (_q('.page.active')?.id || '').replace('page-', '');
  API.invalidate(pid);
  const fn = {
    dashboard: () => Promise.all([loadDashboard(), loadTodayStatus()]),
    history:   loadHistory,
    report:    loadReport,
    users:     loadUsers,
    leave:     loadLeaveHistory,
  };
  fn[pid]?.();
}

/* ════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════ */
async function loadDashboard() {
  try {
    const res = await API.dashboard.get();
    if (!res.success) return;
    const s = res.stats;
    _setText('st-total', s.totalUsers     || 0);
    _setText('st-today', s.todayTotal     || 0);
    _setText('st-late',  s.todayLate      || 0);
    _setText('st-out',   s.todayCheckedOut || 0);
    _setText('todayTotalValue', s.todayTotal || 0);
    renderRecentTable(res.recentRecords || []);
    renderTodayStatusChart(s.todayOnTime || 0, s.todayLate || 0);
    if (currentUser?.role === 'admin') loadMonthlyChart();
  } catch { toast('โหลด Dashboard ไม่สำเร็จ', 'error'); }
}

async function loadTodayStatus() {
  try {
    const res = await API.attendance.todayStatus({ userId: currentUser.uid });
    const c   = _q('#myTodayBody');
    if (!res.checkedIn) {
      c.innerHTML = `<div class="today-panel"><span class="st-dot yellow"></span><span style="color:var(--text2);font-size:13px;flex:1">ยังไม่ได้ลงเวลาเข้างานวันนี้</span><button class="btn btn-teal btn-sm" onclick="switchPage('checkin')"><i class="fas fa-sign-in-alt"></i> ลงเวลาเข้างาน</button></div>`;
    } else if (!res.checkedOut) {
      c.innerHTML = `<div class="today-panel"><div class="st-time-block"><div class="st-time-label">เวลาเข้างาน</div><div class="st-time-val">${res.checkInTime}</div><div style="margin-top:5px">${badge(res.checkInStatus)}${res.lateMinutes > 0 ? `<span style="font-size:11px;color:var(--red);margin-left:5px">สาย ${res.lateMinutes} นาที</span>` : ''}</div></div><div class="st-divider"></div><div class="st-time-block"><div class="st-time-label">เวลาออกงาน</div><div style="font-size:13px;color:var(--text3);margin-top:4px">ยังไม่ได้ลงเวลาออก</div></div><div style="margin-left:auto"><button class="btn btn-orange btn-sm" onclick="switchPage('checkout')"><i class="fas fa-sign-out-alt"></i> ลงเวลาออกงาน</button></div></div>`;
    } else {
      c.innerHTML = `<div class="today-panel"><div class="st-time-block"><div class="st-time-label">เข้างาน</div><div class="st-time-val">${res.checkInTime}</div><div style="margin-top:4px">${badge(res.checkInStatus)}</div></div><div class="st-divider"></div><div class="st-time-block"><div class="st-time-label">ออกงาน</div><div style="font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:700;color:var(--orange)">${res.checkOutTime}</div><div style="margin-top:4px">${badge(res.checkOutStatus)}</div></div><div style="margin-left:auto"><span class="badge b-green" style="font-size:12px;padding:5px 12px"><i class="fas fa-check-circle"></i> ลงเวลาครบแล้ว</span></div></div>`;
    }
  } catch {}
}

function renderRecentTable(records) {
  const tbody = _q('#recentBody');
  if (!records.length) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="fas fa-inbox"></i>ยังไม่มีข้อมูล</div></td></tr>'; return; }
  tbody.innerHTML = records.map(r =>
    `<tr><td style="font-weight:600;white-space:nowrap">${r.date || '-'}</td><td><b>${r.name || '-'}</b></td><td style="font-size:12px;color:var(--text3)">${r.dept || '-'}</td><td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--teal);white-space:nowrap">${r.checkIn || '-'}</td><td>${badge(r.checkInStatus)}</td><td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--orange);white-space:nowrap">${r.checkOut || '-'}</td><td style="max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--text2)">${r.task || '-'}</td></tr>`
  ).join('');
}

function renderTodayStatusChart(ontime, late) {
  const canvas = _q('#todayStatusChart');
  if (!canvas) return;
  if (window._todayStatusChart) { window._todayStatusChart.destroy(); window._todayStatusChart = null; }
  _setText('legendOntime', ontime);
  _setText('legendLate', late);
  const total = ontime + late, hasData = total > 0;
  window._todayStatusChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: ['ตรงเวลา','มาสาย'], datasets: [{ data: hasData ? [ontime, late] : [1], backgroundColor: hasData ? ['rgba(76,175,80,.8)','rgba(239,83,80,.8)'] : ['rgba(200,200,200,.3)'], borderWidth: hasData ? 2 : 0, borderColor: '#fff', hoverOffset: 4 }] },
    options: { responsive: true, maintainAspectRatio: true, cutout: '68%', plugins: { legend: { display: false }, tooltip: { enabled: hasData, callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} คน (${total > 0 ? Math.round(ctx.raw/total*100) : 0}%)` } } }, animation: { animateScale: true } },
  });
}

async function loadMonthlyChart() {
  try {
    const month = _todayYM();
    const res   = await API.dashboard.monthlyStats({ month });
    if (!res.success) return;
    const canvas = _q('#chartByDept');
    if (!canvas) return;
    if (window._chartByDept) { window._chartByDept.destroy(); window._chartByDept = null; }
    const labels  = res.byDept.map(d => d.dept || 'ไม่ระบุ');
    const ontime  = res.byDept.map(d => d.ontime);
    const late    = res.byDept.map(d => d.late);
    const persons = res.byDept.map(d => d.persons);
    window._chartByDept = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'ตรงเวลา', data: ontime, backgroundColor: 'rgba(76,175,80,.8)', borderColor: 'rgba(76,175,80,1)', borderWidth: 1 },{ label: 'มาสาย', data: late, backgroundColor: 'rgba(239,83,80,.8)', borderColor: 'rgba(239,83,80,1)', borderWidth: 1 }] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 16, font: { size: 12 } } }, tooltip: { callbacks: { label: ctx => { const v = ctx.raw||0, t=(ontime[ctx.dataIndex]||0)+(late[ctx.dataIndex]||0); return `${ctx.dataset.label}: ${v} (${t>0?Math.round(v/t*100):0}%)`; }, afterLabel: ctx => `บุคลากร: ${persons[ctx.dataIndex]} คน` } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } } },
    });
  } catch {}
}

/* ════════════════════════════════════════
   CHECK-IN / CHECK-OUT
   ════════════════════════════════════════ */
async function submitCheckIn() {
  if (!Camera.hasCapture('in')) { toast('กรุณาถ่ายรูปก่อน', 'error'); return; }
  setStep('ci', 3);
  const btn = _q('#btnCheckIn');
  _btnLoading(btn, 'กำลังบันทึก...');
  try {
    const res = await API.attendance.checkIn({
      userId:          currentUser.uid,
      userName:        currentUser.name,
      department:      currentUser.dept,
      task:            _val('ciTask'),
      location:        _val('ciLocation'),
      gps:             ciGPS,
      imageBase64:     Camera.getB64('in'),
      signatureBase64: sigPadIn && !sigPadIn.isEmpty() ? sigPadIn.toDataURL() : null,
    });

    if (res.success) {
      toast(res.message, 'success');
      API.invalidate('dashboard');
      Promise.all([loadTodayStatus(), loadDashboard()]);
      Camera.stopAll();
      _q('#ciTask').value = '';
      sigPadIn?.clear();
      setStep('ci', 1);
      setTimeout(() => switchPage('dashboard'), 1500);
    } else {
      toast(res.message, 'error');
      setStep('ci', 2);
      if (res.alreadyIn) {
        setTimeout(() => Swal.fire({
          icon: 'info', title: 'ลงเวลาเข้างานแล้ว',
          html: `คุณได้ลงเวลาเข้างานวันนี้เวลา <b style="color:#26A69A;font-family:'IBM Plex Mono',monospace">${res.checkInTime}</b> แล้ว`,
          confirmButtonText: 'ไปลงเวลาออกงาน', showCancelButton: true,
          cancelButtonText: 'ปิด', confirmButtonColor: '#FF8A65', cancelButtonColor: '#90A4AE',
        }).then(r => { if (r.isConfirmed) switchPage('checkout'); }), 400);
      }
    }
  } catch { toast('เกิดข้อผิดพลาด', 'error'); setStep('ci', 2); }
  finally  { _btnReset(btn, '<i class="fas fa-sign-in-alt"></i> บันทึกเวลาเข้างาน'); }
}

async function submitCheckOut() {
  if (!Camera.hasCapture('out')) { toast('กรุณาถ่ายรูปก่อน', 'error'); return; }
  const btn = _q('#btnCheckOut');
  _btnLoading(btn, 'กำลังบันทึก...');
  try {
    const res = await API.attendance.checkOut({
      userId:          currentUser.uid,
      userName:        currentUser.name,
      department:      currentUser.dept,
      task:            _val('coTask'),
      gps:             coGPS,
      imageBase64:     Camera.getB64('out'),
      signatureBase64: sigPadOut && !sigPadOut.isEmpty() ? sigPadOut.toDataURL() : null,
      attachments:     attachments.map(a => ({ name: a.name, data: a.data, mimeType: a.mimeType })),
    });
    if (res.success) {
      toast(res.message, 'success');
      API.invalidate('dashboard');
      Promise.all([loadTodayStatus(), loadDashboard()]);
      Camera.stopAll();
      _q('#coTask').value = '';
      sigPadOut?.clear();
      attachments = [];
      renderAttachList();
      setTimeout(() => switchPage('dashboard'), 1500);
    } else {
      toast(res.message, 'error');
    }
  } catch { toast('เกิดข้อผิดพลาด', 'error'); }
  finally  { _btnReset(btn, '<i class="fas fa-sign-out-alt"></i> บันทึกเวลาออกงาน'); }
}

/* ════════════════════════════════════════
   STEP INDICATOR
   ════════════════════════════════════════ */
function setStep(pfx, step) {
  for (let i = 1; i <= 3; i++) {
    const c  = _q(`#${pfx}Step${i}`);
    const tEl = c?.nextElementSibling?.querySelector('.step-text');
    if (c) c.className  = i < step ? 'step-circle s-done' : i === step ? 'step-circle s-active' : 'step-circle';
    if (tEl) tEl.className = i === step ? 'step-text s-active' : 'step-text';
  }
  for (let j = 1; j <= 2; j++) {
    const l = _q(`#${pfx}Line${j}`);
    if (l) l.className = j < step ? 'step-line s-done' : 'step-line';
  }
}

/* ════════════════════════════════════════
   SIGNATURE
   ════════════════════════════════════════ */
function initSigPads() {
  [['sigIn','in'],['sigOut','out']].forEach(([cid, type]) => {
    const canvas = _q(`#${cid}`);
    if (!canvas) return;
    const w = Math.max(canvas.parentElement.getBoundingClientRect().width - 4, 200);
    canvas.width  = Math.floor(w);
    canvas.height = 110;
    const pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)', penColor: '#37474F', minWidth: 1.5, maxWidth: 3 });
    if (type === 'in') sigPadIn = pad; else sigPadOut = pad;
  });
}
function resizeSigPads() {
  [['sigIn','in'],['sigOut','out']].forEach(([cid, type]) => {
    const canvas = _q(`#${cid}`), pad = type === 'in' ? sigPadIn : sigPadOut;
    if (!canvas || !pad) return;
    const data = pad.toData(), w = Math.max(canvas.parentElement.getBoundingClientRect().width - 4, 200);
    canvas.width  = Math.floor(w);
    canvas.height = 110;
    pad.clear();
    if (data?.length > 0) pad.fromData(data);
  });
}
function clearSig(t) {
  if (t === 'in'  && sigPadIn)  sigPadIn.clear();
  if (t === 'out' && sigPadOut) sigPadOut.clear();
}

/* ════════════════════════════════════════
   GPS
   ════════════════════════════════════════ */
function getGPS(type) {
  const el = _q(type === 'ci' ? '#ciGPSTxt' : '#coGPSTxt');
  if (el) el.textContent = 'กำลังระบุพิกัด...';
  if (!navigator.geolocation) { if (el) el.textContent = 'ไม่รองรับ GPS'; return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const c = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
      if (type === 'ci') ciGPS = c; else coGPS = c;
      if (el) el.textContent = c;
    },
    () => { if (el) el.textContent = 'ไม่สามารถระบุพิกัดได้'; },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

/* ════════════════════════════════════════
   ATTACHMENTS
   ════════════════════════════════════════ */
function onAttachFiles(input) {
  const files = Array.from(input.files), rem = 3 - attachments.length;
  if (rem <= 0) { toast('แนบได้สูงสุด 3 ไฟล์', 'error'); input.value = ''; return; }
  const toAdd = files.slice(0, rem);
  if (files.length > rem) toast(`เพิ่มได้อีก ${rem} ไฟล์`, 'info');
  toAdd.forEach(file => {
    const r = new FileReader();
    r.onload = ev => { attachments.push({ name: file.name, data: ev.target.result, mimeType: file.type, size: file.size }); renderAttachList(); };
    r.readAsDataURL(file);
  });
  input.value = '';
}
function renderAttachList() {
  const list = _q('#attachList');
  if (!list) return;
  if (!attachments.length) { list.innerHTML = ''; return; }
  const icons = { 'application/pdf':'fa-file-pdf', 'image/jpeg':'fa-file-image', 'image/png':'fa-file-image' };
  list.innerHTML = attachments.map((a, i) =>
    `<div class="attach-item"><i class="fas ${icons[a.mimeType] || 'fa-file'}" style="color:var(--orange)"></i><span>${a.name}</span><span style="font-size:10px;color:var(--text3);flex-shrink:0">${(a.size/1024).toFixed(0)} KB</span><button class="remove-attach" onclick="removeAttach(${i})"><i class="fas fa-times"></i></button></div>`
  ).join('');
}
function removeAttach(i) { attachments.splice(i, 1); renderAttachList(); }

/* ════════════════════════════════════════
   HISTORY
   ════════════════════════════════════════ */
async function loadHistoryUsers() {
  try {
    const res = await API.users.getAll();
    if (!res.success) return;
    const sel = _q('#histUserSel');
    if (!sel) return;
    sel.innerHTML = '<option value="all">-- ทั้งหมด --</option>';
    res.data.forEach(u => sel.innerHTML += `<option value="${u.uid}">${u.name}</option>`);
  } catch {}
}

async function loadHistory() {
  const isAdmin = currentUser?.role === 'admin';
  const cols    = isAdmin ? 11 : 9;
  _q('#histBody').innerHTML = skeletonRows(cols, 5);
  try {
    const uid = isAdmin ? (_q('#histUserSel')?.value || 'all') : currentUser.uid;
    const res = await API.attendance.getAll({
      userId:    uid,
      startDate: _q('#histStart')?.value || undefined,
      endDate:   _q('#histEnd')?.value   || undefined,
    });
    if (!res.success) return;
    _setText('histCount', `${res.data.length} รายการ`);
    renderHistTable(res.data, isAdmin);
  } catch { toast('โหลดประวัติไม่สำเร็จ', 'error'); }
}

function renderHistTable(data, isAdmin) {
  const tbody   = _q('#histBody');
  const colSpan = isAdmin ? 11 : 9;
  if (!data.length) { tbody.innerHTML = `<tr><td colspan="${colSpan}"><div class="empty-state"><i class="fas fa-inbox"></i>ไม่พบข้อมูล</div></td></tr>`; return; }
  tbody.innerHTML = data.map(r => {
    const lm      = parseInt(r['นาทีสาย (เข้า)']) || 0;
    const nameCols = isAdmin
      ? `<td style="white-space:nowrap;font-weight:600">${r['ชื่อ-สกุล'] || '-'}</td><td style="font-size:11px;color:var(--text3)">${r['แผนก'] || '-'}</td>`
      : '';
    return `<tr>${nameCols}<td style="font-weight:600;white-space:nowrap">${r['วันที่'] || '-'}</td><td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--teal);white-space:nowrap">${r['เวลาเข้างาน'] || '-'}</td><td>${badge(r['สถานะเข้า'])}</td><td style="font-family:'IBM Plex Mono',monospace;color:${lm>0?'var(--red)':'var(--text3)'}">${lm}</td><td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--orange);white-space:nowrap">${r['เวลาออกงาน'] || '-'}</td><td>${badge(r['สถานะออก'])}</td><td style="max-width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--text2)">${r['ภารกิจ/ผลงาน (เข้า)'] || '-'}</td><td>${renderAttachLinks(r)}</td><td>${renderImgLinks(r, 'URL รูปเข้า', 'URL รูปออก')}</td></tr>`;
  }).join('');
}

function resetHistFilter() {
  if (_q('#histStart'))   _q('#histStart').value = '';
  if (_q('#histEnd'))     _q('#histEnd').value   = '';
  if (_q('#histUserSel')) _q('#histUserSel').value = 'all';
  loadHistory();
}

/* ════════════════════════════════════════
   RENDER HELPERS
   ════════════════════════════════════════ */
function renderAttachLinks(r) {
  const links = ['URL ไฟล์แนบ 1','URL ไฟล์แนบ 2','URL ไฟล์แนบ 3'].map((f, j) => {
    const v = (r[f] || '').trim();
    return v.startsWith('http')
      ? `<a href="${v}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:3px;color:var(--orange);margin-right:4px;background:rgba(255,138,101,.1);padding:2px 7px;border-radius:9px;border:1px solid rgba(255,138,101,.3);font-size:11px;text-decoration:none"><i class="fas fa-paperclip"></i> ${j+1}</a>`
      : '';
  }).filter(Boolean);
  return links.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px">${links.join('')}</div>` : '<span style="color:var(--text3)">-</span>';
}

function renderImgLinks(r, keyIn, keyOut) {
  let html = '';
  if (r[keyIn])  html += `<a href="javascript:void(0)" class="img-preview" data-url="${encodeURIComponent(r[keyIn])}"  data-title="รูปเข้างาน"  style="color:var(--teal)"><i class="fas fa-eye"></i></a>`;
  if (r[keyOut]) html += `<a href="javascript:void(0)" class="img-preview" data-url="${encodeURIComponent(r[keyOut])}" data-title="รูปออกงาน" style="color:var(--orange);margin-left:5px"><i class="fas fa-eye"></i></a>`;
  return html || '<span style="color:var(--text3)">-</span>';
}

function driveImgUrl(url) {
  if (!url) return '';
  const m1 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const m2 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  const m3 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const fid = (m1?.[1]) || (m2?.[1]) || (m3?.[1]);
  return fid ? `https://drive.google.com/thumbnail?id=${fid}&sz=w800` : url;
}

function previewImg(rawUrl, title) {
  _setText('imgModalTitle', title || 'รูปภาพ');
  const body = _q('#imgModalBody'), link = _q('#imgModalLink');
  body.innerHTML = '<div style="padding:40px;color:var(--text3);text-align:center"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>';
  link.href = rawUrl;
  const img = new Image();
  img.onload  = () => { body.innerHTML = ''; img.style.cssText = 'max-width:100%;max-height:70vh;border-radius:10px;box-shadow:var(--sh-md);object-fit:contain;display:block;margin:0 auto'; body.appendChild(img); };
  img.onerror = () => { body.innerHTML = `<div style="padding:32px;text-align:center"><i class="fas fa-exclamation-circle" style="font-size:36px;color:var(--orange);display:block;margin-bottom:12px"></i><a href="${rawUrl}" target="_blank" class="btn btn-teal" style="text-decoration:none"><i class="fas fa-external-link-alt"></i> เปิดใน Drive</a></div>`; };
  img.src = driveImgUrl(rawUrl);
  showModal('imgModal');
}

/* ════════════════════════════════════════
   REPORT (Admin)
   ════════════════════════════════════════ */
async function loadReportUsers() {
  try {
    const res = await API.users.getAll();
    if (!res.success) return;
    const sel = _q('#rptUser');
    sel.innerHTML = '<option value="all">-- ทั้งหมด --</option>';
    res.data.forEach(u => sel.innerHTML += `<option value="${u.uid}">${u.name}</option>`);
  } catch {}
}

async function loadReport() {
  try {
    const res = await API.attendance.getAll({
      userId:    _val('rptUser'),
      startDate: _q('#rptStart').value  || undefined,
      endDate:   _q('#rptEnd').value    || undefined,
      search:    _val('rptSearch')      || undefined,
    });
    if (!res.success) return;
    allReportData  = res.data;
    currentRptPage = 1;
    const late   = res.data.filter(r => r['สถานะเข้า']  === 'สาย').length;
    const ontime = res.data.filter(r => r['สถานะเข้า']  === 'ตรงเวลา').length;
    const early  = res.data.filter(r => r['สถานะออก']  === 'ออกก่อน').length;
    _rptStats = { ontime, late, early };
    _setText('rptCount',   `${res.data.length} รายการ`);
    _setText('rpt-total',  res.data.length);
    _setText('rpt-ontime', ontime);
    _setText('rpt-late',   late);
    _setText('rpt-early',  early);
    renderReportTable();
  } catch { toast('โหลดรายงานไม่สำเร็จ', 'error'); }
}

function renderReportTable() {
  const start    = (currentRptPage - 1) * RPT_PER_PAGE;
  const pageData = allReportData.slice(start, start + RPT_PER_PAGE);
  const tbody    = _q('#reportBody');
  if (!allReportData.length) { tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state"><i class="fas fa-inbox"></i>ไม่พบข้อมูล</div></td></tr>'; _q('#rptPagination').innerHTML = ''; return; }
  tbody.innerHTML = pageData.map(r => {
    const lm = parseInt(r['นาทีสาย (เข้า)']) || 0;
    return `<tr><td style="font-weight:600;white-space:nowrap">${r['วันที่']||'-'}</td><td style="white-space:nowrap">${r['ชื่อ-สกุล']||'-'}</td><td style="font-size:11px;color:var(--text3)">${r['แผนก']||'-'}</td><td style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--teal);white-space:nowrap">${r['เวลาเข้างาน']||'-'}</td><td>${badge(r['สถานะเข้า'])}</td><td style="font-family:'IBM Plex Mono',monospace;color:${lm>0?'var(--red)':'var(--text3)'}">${lm}</td><td style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--orange);white-space:nowrap">${r['เวลาออกงาน']||'-'}</td><td>${badge(r['สถานะออก'])}</td><td style="font-size:11px;color:var(--text2);max-width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r['ภารกิจ/ผลงาน (เข้า)']||'-'}</td><td>${renderAttachLinks(r)}</td><td>${renderImgLinks(r,'URL รูปเข้า','URL รูปออก')}</td></tr>`;
  }).join('');
  renderPagination();
}
function renderPagination() {
  const total = Math.ceil(allReportData.length / RPT_PER_PAGE), pag = _q('#rptPagination');
  if (total <= 1) { pag.innerHTML = ''; return; }
  let h = `<span class="page-info">${(currentRptPage-1)*RPT_PER_PAGE+1}–${Math.min(currentRptPage*RPT_PER_PAGE,allReportData.length)} / ${allReportData.length}</span>`;
  if (currentRptPage > 1) h += `<button class="page-btn" onclick="changePage(${currentRptPage-1})"><i class="fas fa-chevron-left"></i></button>`;
  for (let i = Math.max(1, currentRptPage-2); i <= Math.min(total, currentRptPage+2); i++) h += `<button class="page-btn ${i===currentRptPage?'active':''}" onclick="changePage(${i})">${i}</button>`;
  if (currentRptPage < total) h += `<button class="page-btn" onclick="changePage(${currentRptPage+1})"><i class="fas fa-chevron-right"></i></button>`;
  pag.innerHTML = h;
}
function changePage(p) { currentRptPage = p; renderReportTable(); window.scrollTo(0, 0); }

/* ════════════════════════════════════════
   MONTHLY REPORT
   ════════════════════════════════════════ */
async function loadMonthlyReport() {
  const month = _val('mrMonth');
  if (!month) { toast('กรุณาเลือกเดือน', 'error'); return; }
  const [y, m] = month.split('-');
  const start = `${month}-01`;
  const end   = `${month}-${String(new Date(+y, +m, 0).getDate()).padStart(2,'0')}`;
  const body  = _q('#monthlyReportBody');
  body.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i> กำลังโหลด...</div>';
  try {
    const [attRes, statsRes] = await Promise.all([
      API.attendance.getAll({ userId: 'all', startDate: start, endDate: end }),
      API.dashboard.monthlyStats({ month }),
    ]);
    if (!attRes.success) { body.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i>ไม่พบข้อมูล</div>'; return; }
    const monthLabel = new Date(+y, +m-1, 1).toLocaleDateString('th-TH', { year:'numeric', month:'long' });
    const stats = statsRes.byUser || [];
    let html = `<div style="margin-bottom:16px"><h3 style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px"><i class="fas fa-chart-line" style="color:var(--teal)"></i> สรุปรายเดือน: ${monthLabel}</h3></div>`;
    html += `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div class="panel-title"><div class="panel-icon" style="background:var(--teal)"><i class="fas fa-table"></i></div>สรุปรายบุคคล</div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>ชื่อ-สกุล</th><th>กลุ่มงาน</th><th>วันที่เข้างาน</th><th>ตรงเวลา</th><th>มาสาย</th><th>ออกก่อน</th><th>%ตรงเวลา</th></tr></thead><tbody>`;
    stats.forEach(u => {
      const pct = u.days > 0 ? Math.round(u.ontime/u.days*100) : 0;
      const pctColor = pct>=80?'var(--green-d)':pct>=60?'var(--orange)':'var(--red)';
      html += `<tr><td><b>${u.name}</b></td><td style="font-size:11px;color:var(--text3)">${u.dept}</td><td style="font-family:'IBM Plex Mono',monospace;text-align:center">${u.days}</td><td><span class="badge b-green">${u.ontime}</span></td><td><span class="badge b-red">${u.late}</span></td><td><span class="badge b-orange">${u.earlyOut}</span></td><td><span style="font-weight:700;color:${pctColor};font-family:'IBM Plex Mono',monospace">${pct}%</span></td></tr>`;
    });
    html += '</tbody></table></div></div>';
    body.innerHTML = html;
  } catch { body.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i>โหลดข้อมูลไม่สำเร็จ</div>'; }
}

/* ════════════════════════════════════════
   LEAVE
   ════════════════════════════════════════ */
const LEAVE_TYPES = [
  { key:'ลาป่วย',    icon:'bxs-first-aid',    quota:30,  color:'#EF5350' },
  { key:'ลากิจ',    icon:'bx-calendar-check', quota:10,  color:'#FF8A65' },
  { key:'ลาพักร้อน', icon:'bxs-sun',           quota:10,  color:'#26A69A' },
  { key:'ลาคลอด',   icon:'bxs-baby-carriage', quota:90,  color:'#AB47BC' },
  { key:'ลาบวช',    icon:'bxs-church',         quota:120, color:'#5C6BC0' },
];

async function checkLeaveEnabled() {
  try {
    const res = await API.system.leaveEnabled();
    const ok  = res.enabled !== false;
    _qa('.nav-item').forEach(el => { if ((el.getAttribute('onclick')||'').includes("'leave'")) el.style.display = ok ? '' : 'none'; });
    _qa('.quick-btn').forEach(el => { if ((el.getAttribute('onclick')||'').includes("'leave'")) el.style.display = ok ? '' : 'none'; });
  } catch {}
}

function calcLeaveDays() {
  const s = _q('#leaveStartDate')?.value, e = _q('#leaveEndDate')?.value;
  if (!s || !e) { if (_q('#leaveDaysCalc')) _q('#leaveDaysCalc').textContent = '0 วัน'; return; }
  const days = Math.max(0, Math.floor((new Date(e) - new Date(s)) / 86400000) + 1);
  if (_q('#leaveDaysCalc')) _q('#leaveDaysCalc').textContent = `${days} วัน`;
}

function renderLeaveQuota(myLeaves) {
  const year = new Date().getFullYear(), grid = _q('#leaveQuotaGrid');
  if (!grid) return;
  grid.innerHTML = LEAVE_TYPES.map(t => {
    const used = (myLeaves || []).filter(l => {
      const p = (l['วันที่เริ่มลา']||'').split('/');
      const yr = p.length === 3 ? parseInt(p[2]) : parseInt((l['วันที่เริ่มลา']||'').split('-')[0]||'0');
      return l['ประเภทการลา'] === t.key && l['สถานะ'] !== 'rejected' && yr === year;
    }).reduce((s, l) => s + parseInt(l['จำนวนวัน']||0), 0);
    const pct = Math.min(Math.round(used/t.quota*100), 100);
    return `<div class="leave-type-card"><div class="lt-icon"><i class="bx ${t.icon}" style="font-size:30px;color:${t.color}"></i></div><div class="lt-name">${t.key}</div><div class="lt-days" style="color:${t.color};font-weight:700">${Math.max(0,t.quota-used)} / ${t.quota} วัน</div><div class="leave-quota-bar"><div class="leave-quota-fill" style="width:${pct}%;background:${t.color}"></div></div></div>`;
  }).join('');
}

async function loadLeaveHistory() {
  const isAdmin = currentUser?.role === 'admin';
  const userId  = isAdmin ? 'all' : currentUser.uid;
  const body    = _q('#leaveHistoryBody');
  body.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i> กำลังโหลด...</div>';
  try {
    const res = await API.leave.getAll({ userId });
    if (!res.success) { body.innerHTML = '<div class="empty-state">ไม่สามารถโหลดข้อมูลได้</div>'; return; }
    const leaves   = res.data || [];
    const myLeaves = leaves.filter(l => String(l['UserID']) === String(currentUser.uid));
    renderLeaveQuota(myLeaves);
    if (!leaves.length) { body.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i>ยังไม่มีประวัติการลา</div>'; return; }
    const typeMap = Object.fromEntries(LEAVE_TYPES.map(t => [t.key, t]));
    const stMap = { pending: ['lb-pending','<i class="bx bx-time-five"></i> รอพิจารณา'], approved: ['lb-approved','<i class="bx bx-check-circle"></i> อนุมัติแล้ว'], rejected: ['lb-rejected','<i class="bx bx-x-circle"></i> ไม่อนุมัติ'] };
    body.innerHTML = leaves.map(l => {
      const t  = typeMap[l['ประเภทการลา']] || { icon:'bx-calendar', color:'#78909C' };
      const sts = l['สถานะ'] || 'pending';
      const st  = stMap[sts] || stMap['pending'];
      return `<div class="leave-card" style="margin-bottom:10px"><div class="leave-card-icon" style="background:${t.color}22;color:${t.color}"><i class="bx ${t.icon}" style="font-size:22px"></i></div><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px"><b>${l['ประเภทการลา']}</b><span class="leave-badge ${st[0]}">${st[1]}</span><span style="font-size:11px;color:var(--text3)">${l['จำนวนวัน']} วัน</span></div><div style="font-size:12px;color:var(--text2)"><i class="bx bx-calendar" style="color:var(--teal)"></i> ${l['วันที่เริ่มลา']} – ${l['วันที่สิ้นสุด']}</div>${isAdmin ? `<div style="font-size:12px;color:var(--text3);margin-top:2px"><i class="bx bxs-user" style="color:var(--blue)"></i> ${l['ชื่อ-สกุล']} (${l['แผนก']})</div>` : ''}<div style="font-size:12px;color:var(--text3);margin-top:3px"><i class="bx bx-message-square-detail"></i> ${l['เหตุผล']}</div>${l['หมายเหตุผู้อนุมัติ'] ? `<div style="font-size:11px;color:var(--red);margin-top:3px"><i class="bx bx-comment-error"></i> หมายเหตุ: ${l['หมายเหตุผู้อนุมัติ']}</div>` : ''}</div>${isAdmin && sts==='pending' ? `<div style="display:flex;gap:6px;flex-shrink:0;flex-direction:column;align-items:flex-end"><button class="btn btn-sm btn-green" onclick="adminUpdateLeave('${l['LeaveID']}','approved')"><i class="bx bx-check"></i> อนุมัติ</button><button class="btn btn-sm btn-red" onclick="adminUpdateLeave('${l['LeaveID']}','rejected')"><i class="bx bx-x"></i> ปฏิเสธ</button></div>` : ''}</div>`;
    }).join('');
  } catch { body.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i>โหลดข้อมูลไม่สำเร็จ</div>'; }
}

async function submitLeave() {
  const type = _val('leaveTypeSelect'), startDate = _val('leaveStartDate'), endDate = _val('leaveEndDate'), reason = _val('leaveReason').trim();
  if (!type || !startDate || !endDate || !reason) { toast('กรุณากรอกข้อมูลให้ครบถ้วน', 'error'); return; }
  if (endDate < startDate) { toast('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น', 'error'); return; }
  const btn = _q('#leaveModal .btn-purple');
  _btnLoading(btn, 'กำลังส่ง...');
  try {
    const res = await API.leave.submit({ userId: currentUser.uid, userName: currentUser.name, dept: currentUser.dept, type, startDate, endDate, reason, delegate: _val('leaveDelegate'), delegateEmail: _val('leaveDelegateEmail') });
    if (res.success) {
      toast(`✅ ${res.message}`, 'success');
      closeModal('leaveModal');
      ['leaveStartDate','leaveEndDate','leaveReason','leaveDelegate','leaveDelegateEmail'].forEach(k => { if (_q(`#${k}`)) _q(`#${k}`).value = ''; });
      if (_q('#leaveTypeSelect')) _q('#leaveTypeSelect').value = 'ลาป่วย';
      if (_q('#leaveDaysCalc'))   _q('#leaveDaysCalc').textContent = '0 วัน';
      loadLeaveHistory();
    } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
  } catch { toast('ไม่สามารถเชื่อมต่อระบบได้', 'error'); }
  finally  { _btnReset(btn, '<i class="fas fa-paper-plane"></i> ส่งใบลา'); }
}

async function adminUpdateLeave(leaveId, status) {
  let note = '';
  if (status === 'rejected') {
    const r = await Swal.fire({ title:'เหตุผลการปฏิเสธ', input:'text', inputPlaceholder:'ระบุเหตุผล (ถ้ามี)', icon:'question', showCancelButton:true, confirmButtonText:'ยืนยัน', cancelButtonText:'ยกเลิก', confirmButtonColor:'#EF5350', cancelButtonColor:'#90A4AE' });
    if (!r.isConfirmed) return;
    note = r.value || '';
  } else {
    const r = await Swal.fire({ title:'ยืนยันการอนุมัติ?', icon:'question', showCancelButton:true, confirmButtonText:'อนุมัติ', cancelButtonText:'ยกเลิก', confirmButtonColor:'#26A69A', cancelButtonColor:'#90A4AE' });
    if (!r.isConfirmed) return;
  }
  Swal.fire({ title:'กำลังบันทึก...', allowOutsideClick:false, didOpen:()=>Swal.showLoading() });
  try {
    const res = await API.leave.updateStatus({ leaveId, status, note, approverName: currentUser.name });
    Swal.close();
    if (res.success) { await Swal.fire({ icon: status==='approved'?'success':'info', title: status==='approved'?'✅ อนุมัติสำเร็จ':'❌ ปฏิเสธแล้ว', text: res.message, confirmButtonColor:'#26A69A', timer:2500, showConfirmButton:false }); loadLeaveHistory(); }
    else toast(res.message||'เกิดข้อผิดพลาด','error');
  } catch { Swal.close(); toast('เกิดข้อผิดพลาด','error'); }
}

/* ════════════════════════════════════════
   USERS (Admin)
   ════════════════════════════════════════ */
async function loadUsers() {
  try {
    const res = await API.users.getAll();
    const grid  = _q('#usersGrid');
    const active = (res.data||[]).filter(u => u.status === 'active');
    if (!active.length) { grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-users"></i>ยังไม่มีผู้ใช้</div>'; return; }
    const colors = [{bg:'rgba(38,166,154,.12)',text:'#00796B'},{bg:'rgba(174,213,129,.2)',text:'#558B2F'},{bg:'rgba(255,202,40,.15)',text:'#F57F17'},{bg:'rgba(255,138,101,.15)',text:'#E64A19'}];
    grid.innerHTML = active.map((u, i) => {
      const c = colors[i%4];
      return `<div class="user-card"><div class="uc-top"><div class="uc-avatar" style="background:${c.bg};color:${c.text}">${(u.name||'?')[0]}</div><div style="min-width:0"><div class="uc-name">${u.name}</div><div class="uc-dept">${u.dept} · ${u.pos||'-'}</div></div></div><div class="uc-meta"><span class="badge ${u.role==='admin'?'b-blue':'b-green'}">${u.role==='admin'?'Admin':'เจ้าหน้าที่'}</span><span style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;max-width:120px">${u.email}</span></div><div class="uc-actions"><button class="btn btn-sm btn-gray" onclick="editUser('${u.uid}','${u.name}','${u.dept}','${u.pos||''}','${u.email}','${u.role}')"><i class="fas fa-edit"></i> แก้ไข</button><button class="btn btn-sm btn-red" onclick="confirmDeleteUser('${u.uid}','${u.name}')"><i class="fas fa-trash"></i></button></div></div>`;
    }).join('');
  } catch { toast('โหลดผู้ใช้ไม่สำเร็จ', 'error'); }
}

function showAddUser() { _setText('userModalTitle','เพิ่มเจ้าหน้าที่'); _q('#editUid').value=''; ['uName','uDept','uPos','uEmail','uPass'].forEach(k => _q(`#${k}`).value=''); _q('#uRole').value='user'; showModal('userModal'); }
function editUser(uid,name,dept,pos,email,role) { _setText('userModalTitle','แก้ไขเจ้าหน้าที่'); _q('#editUid').value=uid; _q('#uName').value=name; _q('#uDept').value=dept; _q('#uPos').value=pos; _q('#uEmail').value=email; _q('#uRole').value=role; _q('#uPass').value=''; showModal('userModal'); }

async function saveUser() {
  const uid = _q('#editUid').value;
  try {
    const res = await (uid ? API.users.update : API.users.add)({ uid, name:_val('uName'), dept:_val('uDept'), pos:_val('uPos'), email:_val('uEmail'), password:_val('uPass'), role:_val('uRole') });
    if (res.success) { toast(res.message,'success'); closeModal('userModal'); API.invalidate('users_list'); loadUsers(); }
    else toast(res.message,'error');
  } catch { toast('เกิดข้อผิดพลาด','error'); }
}

async function confirmDeleteUser(uid,name) {
  const r = await Swal.fire({ title:`ลบ "${name}"?`, text:'ผู้ใช้จะถูกตั้งสถานะเป็น inactive', icon:'warning', showCancelButton:true, confirmButtonText:'ลบ', cancelButtonText:'ยกเลิก', confirmButtonColor:'#EF5350', cancelButtonColor:'#90A4AE' });
  if (!r.isConfirmed) return;
  try { const res=await API.users.delete({uid}); if(res.success){toast('ลบผู้ใช้สำเร็จ','success');API.invalidate('users_list');loadUsers();}else toast(res.message,'error'); } catch { toast('เกิดข้อผิดพลาด','error'); }
}

/* ════════════════════════════════════════
   PDF PRINT
   ════════════════════════════════════════ */
function openDailyPdfModal() {
  _q('#pdfPreview').style.display='none'; _q('#pdfEmpty').style.display='none';
  _q('#btnDoPrint').style.display='none'; _q('#pdfPreviewContent').innerHTML='';
  dailyPdfData=[];
  showModal('pdfModal');
}

async function loadDailyPdfPreview() {
  const dateVal = _q('#pdfDate').value;
  if (!dateVal) { toast('กรุณาเลือกวันที่','error'); return; }
  const [y,m,d] = dateVal.split('-');
  const thaiDate = `${d}/${m}/${y}`;
  try {
    const res = await API.attendance.getAll({ startDate:dateVal, endDate:dateVal, userId:'all' });
    if (!res.success) { toast('โหลดข้อมูลไม่สำเร็จ','error'); return; }
    dailyPdfData = res.data||[];
    if (!dailyPdfData.length) { _q('#pdfPreview').style.display='none'; _q('#pdfEmpty').style.display='block'; _q('#btnDoPrint').style.display='none'; return; }
    _q('#pdfEmpty').style.display='none'; _q('#pdfPreview').style.display='block'; _q('#btnDoPrint').style.display='inline-flex';
    _q('#pdfPreviewContent').innerHTML = _buildPdfHtml(dailyPdfData, thaiDate);
  } catch { toast('เกิดข้อผิดพลาด','error'); }
}

function doPrintPdf() {
  if (!dailyPdfData.length) { toast('ไม่มีข้อมูลสำหรับพิมพ์','error'); return; }
  const [y,m,d] = (_q('#pdfDate').value||'').split('-');
  _doPrint(_buildPdfHtml(dailyPdfData, `${d}/${m}/${y}`), 'รายงานประจำวัน');
}

function printReportTable() {
  if (!allReportData.length) { toast('กรุณาค้นหาข้อมูลก่อน','error'); return; }
  const rows = allReportData.map(r => {
    const lm = parseInt(r['นาทีสาย (เข้า)'])||0;
    const inSt=r['สถานะเข้า']||'-', outSt=r['สถานะออก']||'-';
    return `<tr><td>${r['วันที่']||'-'}</td><td style="text-align:left">${r['ชื่อ-สกุล']||'-'}</td><td>${r['แผนก']||'-'}</td><td>${r['เวลาเข้างาน']||'-'}</td><td class="${lm>0?'late-cell':'ok-cell'}">${inSt}</td><td>${lm}</td><td>${r['เวลาออกงาน']||'-'}</td><td class="${outSt==='ออกก่อน'?'late-cell':outSt==='ตรงเวลา'?'ok-cell':''}">${outSt}</td><td style="text-align:left">${r['ภารกิจ/ผลงาน (เข้า)']||'-'}</td></tr>`;
  }).join('');
  const content = `<div style="font-family:Sarabun,sans-serif;font-size:13px"><div style="text-align:center;margin-bottom:16px;border-bottom:1px solid #ddd;padding-bottom:10px"><div style="font-size:16px;font-weight:700;color:#263238">รายงานการปฏิบัติงาน Work From Home</div><div style="font-size:12px;color:#546E7A">ทั้งหมด: ${allReportData.length} | ตรงเวลา: ${_rptStats.ontime} | สาย: ${_rptStats.late} | ออกก่อน: ${_rptStats.early}</div></div><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr><th style="background:#263238;color:white;padding:7px 8px">วันที่</th><th style="background:#263238;color:white;padding:7px 8px;text-align:left">ชื่อ-สกุล</th><th style="background:#263238;color:white;padding:7px 8px">กลุ่ม</th><th style="background:#263238;color:white;padding:7px 8px">เวลาเข้า</th><th style="background:#263238;color:white;padding:7px 8px">สถานะ</th><th style="background:#263238;color:white;padding:7px 8px">สาย(น.)</th><th style="background:#263238;color:white;padding:7px 8px">เวลาออก</th><th style="background:#263238;color:white;padding:7px 8px">สถานะออก</th><th style="background:#263238;color:white;padding:7px 8px;text-align:left">ภารกิจ</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  _doPrint(content, 'รายงานการลงเวลา');
}

function printMonthlyReport() {
  const body = _q('#monthlyReportBody')?.innerHTML;
  if (!body || body.includes('fa-spinner')) { toast('กรุณาโหลดข้อมูลก่อน','error'); return; }
  _doPrint(`<div style="font-family:Sarabun,sans-serif">${body}</div>`, 'รายงานรายเดือน');
}

function _buildPdfHtml(data, dateLabel) {
  const s1n = _q('#signerName1')?.value || '..................................';
  const s1p = _q('#signerPos1')?.value  || '(ผู้ตรวจสอบ)';
  const s2n = _q('#signerName2')?.value || '..................................';
  const s2p = _q('#signerPos2')?.value  || '(ผู้อนุมัติ)';
  let ontime=0, late=0, earlyOut=0;
  const rows = data.map((r,i) => {
    const lm=parseInt(r['นาทีสาย (เข้า)'])||0;
    const inSt=r['สถานะเข้า']||'-', outSt=r['สถานะออก']||'-';
    if(inSt==='ตรงเวลา')ontime++; if(inSt==='สาย')late++; if(outSt==='ออกก่อน')earlyOut++;
    return `<tr><td style="text-align:center">${i+1}</td><td style="text-align:left">${r['ชื่อ-สกุล']||'-'}</td><td>${r['แผนก']||'-'}</td><td>${r['เวลาเข้างาน']||'-'}</td><td class="${lm>0?'late-cell':'ok-cell'}">${lm>0?'สาย '+lm+' น.':'ตรงเวลา'}</td><td>${r['เวลาออกงาน']||'-'}</td><td class="${outSt==='ออกก่อน'?'late-cell':outSt==='ตรงเวลา'?'ok-cell':''}">${outSt}</td><td style="text-align:left;font-size:11px">${r['ภารกิจ/ผลงาน (เข้า)']||'-'}</td></tr>`;
  }).join('');
  return `<div style="font-family:Sarabun,sans-serif;font-size:13px"><div style="text-align:center;margin-bottom:14px;border-bottom:1px solid #ddd;padding-bottom:10px"><div style="font-size:16px;font-weight:700;color:#263238">WFH System</div><div style="font-size:14px;font-weight:600;margin:4px 0">รายงานการปฏิบัติงาน Work From Home</div><div style="font-size:12px;color:#546E7A">ประจำวันที่ ${dateLabel}</div></div><div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;justify-content:center"><span style="background:#e8f5e9;padding:3px 12px;border-radius:18px;font-size:11px;font-weight:600;color:#388E3C">ตรงเวลา: ${ontime}</span><span style="background:#ffebee;padding:3px 12px;border-radius:18px;font-size:11px;font-weight:600;color:#C62828">มาสาย: ${late}</span><span style="background:#fff3e0;padding:3px 12px;border-radius:18px;font-size:11px;font-weight:600;color:#E64A19">ออกก่อน: ${earlyOut}</span><span style="background:#e3f2fd;padding:3px 12px;border-radius:18px;font-size:11px;font-weight:600;color:#0288D1">รวม: ${data.length}</span></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="background:#263238;color:white;padding:6px 8px;width:35px">#</th><th style="background:#263238;color:white;padding:6px 8px;text-align:left">ชื่อ-สกุล</th><th style="background:#263238;color:white;padding:6px 8px">กลุ่ม</th><th style="background:#263238;color:white;padding:6px 8px">เวลาเข้า</th><th style="background:#263238;color:white;padding:6px 8px">สถานะเข้า</th><th style="background:#263238;color:white;padding:6px 8px">เวลาออก</th><th style="background:#263238;color:white;padding:6px 8px">สถานะออก</th><th style="background:#263238;color:white;padding:6px 8px;text-align:left">ภารกิจ</th></tr></thead><tbody>${rows}</tbody></table><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:30px"><div style="text-align:center;border-top:1.5px solid #888;padding-top:6px;font-size:12px;color:#555"><div style="height:56px"></div>(${currentUser?.name||''})<br>ผู้จัดทำ</div><div style="text-align:center;border-top:1.5px solid #888;padding-top:6px;font-size:12px;color:#555"><div style="height:56px"></div>(${s1n})<br>${s1p}</div><div style="text-align:center;border-top:1.5px solid #888;padding-top:6px;font-size:12px;color:#555"><div style="height:56px"></div>(${s2n})<br>${s2p}</div></div></div>`;
}

function _doPrint(contentHtml, title) {
  const css = `*{box-sizing:border-box}body{font-family:'Sarabun',sans-serif;margin:20px;color:#333;font-size:13px}.late-cell{color:#C62828;font-weight:600}.ok-cell{color:#388E3C;font-weight:600}table{width:100%;border-collapse:collapse}td{border:1px solid #ddd;padding:5px 8px;text-align:center}tr:nth-child(even) td{background:#f9f9f9}@media print{@page{size:A4 landscape;margin:15mm}body{margin:0}}`;
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet"><style>${css}</style></head><body>${contentHtml}<script>window.onload=function(){document.fonts.ready.then(function(){setTimeout(function(){window.focus();window.print();},500)});}<\/script></body></html>`;
  try {
    const blob    = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    let pf = document.getElementById('_printFrame');
    if (pf) document.body.removeChild(pf);
    pf = document.createElement('iframe');
    pf.id = '_printFrame';
    pf.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1200px;height:800px;border:none;opacity:0;pointer-events:none;';
    document.body.appendChild(pf);
    pf.onload = () => { setTimeout(() => { try { pf.contentWindow.focus(); pf.contentWindow.print(); } catch { window.open(blobUrl,'_blank'); } setTimeout(() => URL.revokeObjectURL(blobUrl), 30000); }, 800); };
    pf.src = blobUrl;
  } catch {
    const pw = window.open('','_blank');
    if (pw) { pw.document.write(fullHtml); pw.document.close(); setTimeout(() => { pw.focus(); pw.print(); }, 800); }
    else toast('กรุณาอนุญาต Popup เพื่อพิมพ์','error');
  }
}

/* ════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════ */
const _q  = sel => document.querySelector(sel);
const _qa = sel => document.querySelectorAll(sel);
const _val = id  => (document.getElementById(id)?.value || '').trim();
const _setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

function show(id) { const el = document.getElementById(id); if (el) el.style.display = 'flex'; }
function hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function showModal(id) { document.getElementById(id)?.classList.add('show'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('show'); }

function badge(status) {
  if (!status || status === '-' || status === '') return '<span class="badge b-gray">-</span>';
  const map = { 'ตรงเวลา': ['b-green','fas fa-check'], 'สาย': ['b-red','fas fa-clock'], 'ออกก่อน': ['b-orange','fas fa-exclamation'] };
  const m = map[status];
  return m ? `<span class="badge ${m[0]}"><i class="${m[1]}"></i> ${status}</span>` : `<span class="badge b-gray">${status}</span>`;
}

function toast(msg, type = 'info') {
  const c = document.getElementById('toast');
  if (!c) return;
  const item  = document.createElement('div');
  const icons = { success:'fa-check-circle', error:'fa-exclamation-circle', info:'fa-info-circle' };
  item.className = `toast-item ${type}`;
  item.innerHTML = `<i class="fas ${icons[type]||'fa-info-circle'}"></i> ${msg}`;
  c.appendChild(item);
  setTimeout(() => { item.style.animation = 'fadeOut .3s ease forwards'; setTimeout(() => item.remove(), 300); }, 3700);
}

// expose globally so camera.js can call
window.toast = toast;

function skeletonRows(cols, count = 5) {
  const cell = `<td><div style="height:14px;background:linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%);background-size:200% 100%;animation:shimmer 1.2s infinite;border-radius:4px"></div></td>`;
  return `<tr>${cell.repeat(cols)}</tr>`.repeat(count);
}

function _startClock() {
  setInterval(() => {
    const n = new Date();
    const el = document.getElementById('liveClock');
    if (el) el.textContent = [n.getHours(), n.getMinutes(), n.getSeconds()].map(x => String(x).padStart(2,'0')).join(':');
  }, 1000);
}
function _updateDate() {
  const d = new Date();
  _setText('pageDate',   d.toLocaleDateString('th-TH', { weekday:'long', year:'numeric', month:'long', day:'numeric' }));
  _setText('topbarDate', d.toLocaleDateString('th-TH'));
}

const _todayISO = () => new Date().toISOString().substring(0, 10);
const _todayYM  = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; };

function _btnLoading(btn, msg = 'กำลังโหลด...') { if (!btn) return; btn._orig = btn.innerHTML; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${msg}`; btn.disabled = true; }
function _btnReset(btn, html) { if (!btn) return; btn.innerHTML = html || btn._orig || ''; btn.disabled = false; }

/* ════════════════════════════════════════
   EVENT LISTENERS
   ════════════════════════════════════════ */
document.addEventListener('click', e => {
  const a = e.target.closest('a.img-preview');
  if (!a) return;
  e.preventDefault();
  const rawUrl = decodeURIComponent(a.getAttribute('data-url') || '');
  const title  = a.getAttribute('data-title') || 'รูปภาพ';
  if (rawUrl) previewImg(rawUrl, title);
});

document.querySelectorAll('.modal-overlay').forEach(o =>
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('show'); })
);

let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(resizeSigPads, 250);
});

window.addEventListener('beforeunload', () => Camera.stopAll());
</script>
