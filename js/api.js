
  /**
 * api.js — WFH System API Layer
 * ──────────────────────────────
 * ทุก call ไปยัง Google Apps Script ผ่านที่นี่เท่านั้น
 * มี: caching, retry, request queue
 */

'use strict';

const API = (() => {

  /* ─── CONFIG (แก้ SCRIPT_URL ตรงนี้ที่เดียว) ────────────── */
  const SCRIPT_URL = window.GAS_URL ||
    'https://script.google.com/macros/s/AKfycbzeiLiAXRN2WBGxxczwXm1frdj1x7BOCNoNd9RUE98zMWVWiA16B3kaYwNimHC6xSlz/exec';

  /* ─── Simple in-memory cache (TTL = 2 min) ──────────────── */
  const _cache = new Map();

  function _cacheGet(key) {
    const e = _cache.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > 120_000) { _cache.delete(key); return null; }
    return e.data;
  }
  function _cacheSet(key, data) { _cache.set(key, { data, ts: Date.now() }); }
  function invalidate(prefix) {
    for (const k of _cache.keys()) { if (k.startsWith(prefix)) _cache.delete(k); }
  }
  function clearAll() { _cache.clear(); }

  /* ─── Core fetch ─────────────────────────────────────────── */
  async function _post(payload, { cacheKey, retry = 2 } = {}) {
    if (cacheKey) {
      const cached = _cacheGet(cacheKey);
      if (cached) return cached;
    }

    let lastErr;
    for (let attempt = 0; attempt <= retry; attempt++) {
      try {
        const res = await fetch(SCRIPT_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'text/plain' },  // GAS ต้องการ text/plain (ไม่ block CORS)
          body:    JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cacheKey && data.success) _cacheSet(cacheKey, data);
        return data;
      } catch (err) {
        lastErr = err;
        if (attempt < retry) await _sleep(500 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  const _sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ─── AUTH ───────────────────────────────────────────────── */
  const auth = {
    login:    d => _post({ action: 'login',          ...d }),
    register: d => _post({ action: 'register',       ...d }),
    forgot:   d => _post({ action: 'forgotPassword', ...d }),
  };

  /* ─── SYSTEM ─────────────────────────────────────────────── */
  const system = {
    init:        ()  => _post({ action: 'init' }),
    leaveEnabled: () => _post({ action: 'getLeaveEnabled' }, { cacheKey: 'leaveEnabled' }),
  };

  /* ─── ATTENDANCE ─────────────────────────────────────────── */
  const attendance = {
    checkIn: d  => _post({ action: 'checkIn',       ...d }),
    checkOut: d => _post({ action: 'checkOut',      ...d }),
    todayStatus: d => _post({ action: 'getTodayStatus', ...d }),
    getAll: d   => _post({ action: 'getAttendance', ...d }),
    getMyHistory: d => _post({ action: 'getMyHistory', ...d }),
  };

  /* ─── DASHBOARD ──────────────────────────────────────────── */
  const dashboard = {
    get:          ()  => _post({ action: 'getDashboard' }),
    monthlyStats: d   => _post({ action: 'getMonthlyStats', ...d },
                               { cacheKey: `monthlyStats_${d.month}` }),
  };

  /* ─── USERS ──────────────────────────────────────────────── */
  const users = {
    getAll:  ()  => _post({ action: 'getUsers' }, { cacheKey: 'users_list' }),
    add:     d   => _post({ action: 'addUser',    ...d }),
    update:  d   => _post({ action: 'updateUser', ...d }),
    delete:  d   => _post({ action: 'deleteUser', ...d }),
  };

  /* ─── LEAVE ──────────────────────────────────────────────── */
  const leave = {
    submit:       d => _post({ action: 'submitLeave',       ...d }),
    getAll:       d => _post({ action: 'getLeaves',         ...d }),
    updateStatus: d => _post({ action: 'updateLeaveStatus', ...d }),
  };

  /* ─── FILES (image / attachment upload to Drive) ─────────── */
  const files = {
    saveImage:      d => _post({ action: 'saveImage',      ...d }),
    saveAttachment: d => _post({ action: 'saveAttachment', ...d }),
  };

  /* ─── Public ─────────────────────────────────────────────── */
  return { auth, system, attendance, dashboard, users, leave, files, invalidate, clearAll };
})();

