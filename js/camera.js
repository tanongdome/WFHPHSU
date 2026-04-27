
  /**
 * camera.js — WFH System Camera Module
 * ─────────────────────────────────────
 * รองรับ: Chrome, Safari iOS, Android, LINE (redirect), iframe
 * หลักการ: MediaStream API ก่อน → fallback file input
 */

'use strict';

const Camera = (() => {

  /* ── ตรวจสอบ environment ──────────────────────────────── */
  const UA = navigator.userAgent || '';
  const ENV = {
    isLine:    /Line\//i.test(UA),
    isIOS:     /iPhone|iPad|iPod/i.test(UA),
    isAndroid: /Android/i.test(UA),
    isMobile:  /Android|iPhone|iPad|iPod|Mobile/i.test(UA),
    isIframe:  (() => { try { return window.self !== window.top; } catch { return true; } })(),
    isHTTPS:   location.protocol === 'https:' || location.hostname === 'localhost',
    hasCam:    !!(navigator.mediaDevices?.getUserMedia),
  };

  /* ── สถานะกล้องแต่ละ slot ────────────────────────────── */
  const _state = {};   // { in: {...}, out: {...} }

  function _initState(slot) {
    if (_state[slot]) return;
    _state[slot] = {
      stream:    null,
      b64:       null,      // รูปสุดท้ายที่ capture
      facingMode: 'user',   // 'user' | 'environment'
      liveActive: false,
    };
  }

  /* ── DOM helpers ─────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  function _el(slot, name) {
    const map = {
      wrap:       `camWrap${_cap(slot)}`,
      video:      `camVid${_cap(slot)}`,
      canvas:     `camCanvas${_cap(slot)}`,
      img:        `camImg${_cap(slot)}`,
      placeholder:`camPh${_cap(slot)}`,
      liveBadge:  `camLive${_cap(slot)}`,
      fileInput:  `file${_cap(slot)}`,
      fileLabel:  `fileLabel${_cap(slot)}`,
      retakeRow:  `retakeRow${_cap(slot)}`,
      liveSect:   `camLiveSection${_cap(slot)}`,
      btnCam:     `btnCam${_cap(slot)}`,
      btnCap:     `btnCap${_cap(slot)}`,
      btnRetake:  `btnRetake${_cap(slot)}`,
      errBox:     `camErr${_cap(slot)}`,
      guideBox:   `camGuide${_cap(slot)}`,
    };
    return $(map[name]);
  }
  const _cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ── INIT (เรียกครั้งเดียวตอน load) ───────────────────── */
  function init() {
    ['in', 'out'].forEach(slot => {
      _initState(slot);
      _setupFileInput(slot);
      _applyEnvHints(slot);
    });

    // LINE browser — แสดง banner แนะนำเปิด Chrome
    if (ENV.isLine) _showLineBanner();
  }

  function _applyEnvHints(slot) {
    const fi = _el(slot, 'fileInput');
    const lt = $(slot === 'in' ? 'fileLabelInText' : 'fileLabelOutText');
    const ls = _el(slot, 'liveSect');

    if (!fi) return;

    if (ENV.isMobile) {
      fi.setAttribute('capture', 'user');   // เปิดกล้องหน้าโดยตรงบนมือถือ
      if (lt) lt.textContent = 'เปิดกล้องถ่ายรูป';
    } else {
      fi.removeAttribute('capture');
      if (lt) lt.textContent = 'เลือกไฟล์รูปภาพ';
    }

    // ซ่อน Live Camera section ถ้า: มือถือ หรือ iframe (กล้องสดไม่ทำงานใน iframe)
    if (ls && (ENV.isMobile || ENV.isIframe || !ENV.hasCam || !ENV.isHTTPS)) {
      ls.style.display = 'none';
    }
  }

  /* ── FILE INPUT (primary path) ───────────────────────── */
  function _setupFileInput(slot) {
    const fi = _el(slot, 'fileInput');
    if (!fi) return;
    fi.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => _setCapture(slot, ev.target.result, 'file');
      reader.readAsDataURL(file);
      fi.value = '';  // reset ให้เลือกซ้ำได้
    });
  }

  /* ── LIVE CAMERA (desktop secondary path) ──────────────── */
  async function startLive(slot) {
    _initState(slot);
    if (!ENV.hasCam) { _showError(slot, 'เบราว์เซอร์ไม่รองรับกล้องสด — ใช้ปุ่มถ่ายรูปด้านบน'); return; }
    if (!ENV.isHTTPS) { _showError(slot, 'กล้องสดต้องใช้ HTTPS — กรุณาเปิดผ่าน https://'); return; }

    const btnCam = _el(slot, 'btnCam');
    if (btnCam) { btnCam.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btnCam.disabled = true; }
    _clearError(slot);

    // หยุดกล้องเก่าก่อน
    _stopStream(slot);

    try {
      const stream = await _requestCamera();
      _state[slot].stream = stream;
      _state[slot].liveActive = true;

      const vid = _el(slot, 'video');
      vid.srcObject = stream;
      vid.style.display = 'block';
      _el(slot, 'placeholder').style.display = 'none';
      _el(slot, 'liveBadge').style.display = 'flex';

      const btnCap = _el(slot, 'btnCap');
      if (btnCap) btnCap.disabled = false;

      await vid.play().catch(() => {});

      if (btnCam) {
        btnCam.innerHTML = '<i class="fas fa-circle" style="color:#f44"></i> กล้องเปิดอยู่';
        btnCam.disabled = false;
      }
    } catch (err) {
      _handleCamError(slot, err);
      if (btnCam) { btnCam.innerHTML = '<i class="fas fa-video"></i> เปิดกล้องสด'; btnCam.disabled = false; }
    }
  }

  async function _requestCamera() {
    const constraints = [
      { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: 'user' }, audio: false },
      { video: true, audio: false },
    ];
    for (const c of constraints) {
      try { return await navigator.mediaDevices.getUserMedia(c); } catch {}
    }
    throw new Error('PermissionDenied');
  }

  function captureFromLive(slot) {
    const vid = _el(slot, 'video');
    if (!vid?.videoWidth) { _showError(slot, 'กล้องยังไม่พร้อม'); return; }

    const canvas = _el(slot, 'canvas');
    canvas.width  = vid.videoWidth;
    canvas.height = vid.videoHeight;
    canvas.getContext('2d').drawImage(vid, 0, 0);
    const b64 = canvas.toDataURL('image/jpeg', 0.88);
    _stopStream(slot);
    _setCapture(slot, b64, 'live');
  }

  /* ── FLIP CAMERA ────────────────────────────────────────── */
  async function flipCamera(slot) {
    _state[slot].facingMode = _state[slot].facingMode === 'user' ? 'environment' : 'user';
    _stopStream(slot);
    await startLive(slot);
  }

  /* ── RETAKE ──────────────────────────────────────────────── */
  function retake(slot) {
    _clearCapture(slot);
    // ถ้าเคยใช้ live → เปิดกล้องใหม่
    if (_state[slot].liveActive) {
      startLive(slot);
    }
  }

  /* ── ตั้งค่ารูปที่ capture ─────────────────────────────── */
  function _setCapture(slot, b64, source) {
    _state[slot].b64 = b64;
    _state[slot].liveActive = (source === 'live');

    const img  = _el(slot, 'img');
    const vid  = _el(slot, 'video');
    const ph   = _el(slot, 'placeholder');
    const lb   = _el(slot, 'liveBadge');
    const rr   = _el(slot, 'retakeRow');
    const fl   = _el(slot, 'fileLabel');
    const ls   = _el(slot, 'liveSect');
    const bcap = _el(slot, 'btnCap');
    const bret = _el(slot, 'btnRetake');

    if (img)  { img.src = b64; img.style.display = 'block'; }
    if (vid)  { vid.style.display = 'none'; }
    if (ph)   ph.style.display = 'none';
    if (lb)   lb.style.display = 'none';
    if (rr)   rr.classList.add('show');
    if (fl)   fl.style.display = 'none';
    if (ls)   ls.style.display = 'none';
    if (bcap) { bcap.style.display = 'inline-flex'; bcap.disabled = true; }
    if (bret) bret.style.display = 'none';

    _clearError(slot);

    // callback สำหรับ step indicator
    Camera.onCapture?.(slot, b64);
    _toast('ได้รูปภาพแล้ว ✓', 'success');
  }

  function _clearCapture(slot) {
    _state[slot].b64 = null;
    _stopStream(slot);

    const img  = _el(slot, 'img');
    const ph   = _el(slot, 'placeholder');
    const lb   = _el(slot, 'liveBadge');
    const rr   = _el(slot, 'retakeRow');
    const fl   = _el(slot, 'fileLabel');
    const ls   = _el(slot, 'liveSect');
    const bcap = _el(slot, 'btnCap');

    if (img)  { img.style.display = 'none'; img.src = ''; }
    if (ph)   ph.style.display = 'flex';
    if (lb)   lb.style.display = 'none';
    if (rr)   rr.classList.remove('show');
    if (fl)   fl.style.display = '';
    if (ls && !ENV.isMobile && !ENV.isIframe && ENV.hasCam && ENV.isHTTPS) ls.style.display = '';
    if (bcap) { bcap.style.display = 'inline-flex'; bcap.disabled = true; }

    Camera.onRetake?.(slot);
  }

  /* ── STOP STREAM ─────────────────────────────────────────── */
  function _stopStream(slot) {
    const s = _state[slot]?.stream;
    if (s) { s.getTracks().forEach(t => t.stop()); }
    if (_state[slot]) _state[slot].stream = null;

    const vid = _el(slot, 'video');
    if (vid) { vid.srcObject = null; vid.style.display = 'none'; }
    const lb = _el(slot, 'liveBadge');
    if (lb) lb.style.display = 'none';
  }

  function stopAll() {
    ['in', 'out'].forEach(_stopStream);
  }

  /* ── ERROR HANDLING ──────────────────────────────────────── */
  function _handleCamError(slot, err) {
    const name = err?.name || err?.message || '';
    let msg = 'ไม่สามารถเปิดกล้องได้', showGuide = false;

    if (/NotAllowed|PermissionDenied/i.test(name)) {
      msg = '🔒 กล้องถูกปฏิเสธ — กรุณาอนุญาตกล้องแล้วรีเฟรช';
      showGuide = true;
    } else if (/NotFound|DevicesNotFound/i.test(name)) {
      msg = '📷 ไม่พบกล้องในอุปกรณ์นี้';
    } else if (/NotReadable|TrackStartError/i.test(name)) {
      msg = '⚠️ กล้องถูกใช้โดยแอปอื่น — ปิดแอปอื่นแล้วลองใหม่';
    } else if (/NotSupported|TypeError/i.test(name)) {
      msg = '❌ เบราว์เซอร์ไม่รองรับ — ใช้ Chrome หรือ Safari';
    } else if (/OverconstrainedError/i.test(name)) {
      msg = '⚙️ ค่ากล้องไม่รองรับ — กำลังลองค่าอื่น...';
    }

    _showError(slot, msg);
    if (showGuide) {
      const g = _el(slot, 'guideBox');
      if (g) g.classList.add('show');
    }
  }

  function _showError(slot, msg) {
    const el = _el(slot, 'errBox');
    if (!el) return;
    el.innerHTML = `<i class="fas fa-exclamation-triangle" style="flex-shrink:0;margin-top:1px"></i><span>${msg}</span>`;
    el.classList.add('show');
  }
  function _clearError(slot) {
    const el = _el(slot, 'errBox');
    if (el) el.classList.remove('show');
    const g = _el(slot, 'guideBox');
    if (g) g.classList.remove('show');
  }

  /* ── LINE BROWSER BANNER ─────────────────────────────────── */
  function _showLineBanner() {
    const banner = $('lineBanner');
    if (banner) {
      setTimeout(() => banner.classList.add('show'), 600);
    }
  }

  function tryOpenChrome() {
    const url = location.href;
    if (ENV.isAndroid) {
      location.replace(`intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`);
    } else if (ENV.isIOS) {
      location.replace(url.replace(/^https/, 'googlechromes').replace(/^http/, 'googlechrome'));
    }
  }

  function dismissLineBanner() {
    const b = $('lineBanner');
    if (b) b.classList.remove('show');
  }

  /* ── PUBLIC GETTERS ──────────────────────────────────────── */
  function getB64(slot) { return _state[slot]?.b64 || null; }
  function hasCapture(slot) { return !!_state[slot]?.b64; }
  function getEnv() { return { ...ENV }; }

  /* ── TOAST helper (ใช้จาก app.js ถ้ามี) ─────────────────── */
  function _toast(msg, type) {
    if (typeof window.toast === 'function') window.toast(msg, type);
  }

  /* ── Public API ──────────────────────────────────────────── */
  return {
    init,
    startLive,
    captureFromLive,
    flipCamera,
    retake,
    stopAll,
    getB64,
    hasCapture,
    getEnv,
    tryOpenChrome,
    dismissLineBanner,
    // callbacks — กำหนดจากภายนอก
    onCapture: null,   // (slot, b64) => void
    onRetake:  null,   // (slot) => void
  };
})();

