// 聲音報表 — 網頁版（PWA）主程式（由 ContentView.swift 移植）
import {
  newProject, newTake, normalizeProject, cloneTracks, isFirstTakeOfShot, effectiveContext, allContexts,
  filterTakes, groupTakes, buildExportFile, parseImportFile, compareForImport, describeLastTake,
  safeFileName, stamp, TRACK_COUNT,
  nextTakeNumberFor, APP_VERSION,
} from './logic.js';
import { loadState, saveState, addSnapshot, listSnapshots, deleteSnapshot, requestPersistence } from './store.js';


// MARK: - 狀態

const state = {
  projects: [],
  selectedProjectID: null,
  view: 'list',          // 手機：list | detail
  searchText: '',
  editTakes: false,
  editProjects: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const selectedProject = () => state.projects.find(p => p.id === state.selectedProjectID) || null;

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(state.projects, state.selectedProjectID), 120);
}
function touch(project) { if (project) project.updatedAt = Date.now(); persist(); }
// 離開或切到背景時立刻存檔
const flush = () => { clearTimeout(saveTimer); saveState(state.projects, state.selectedProjectID); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);

// MARK: - 圖示

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l-8 8 8 8"/></svg>',
  chev: '<svg viewBox="0 0 10 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l6 6-6 6"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 2.8h8l4.5 4.5v13.9H6z"/><path d="M14 2.8v4.6h4.5"/><path d="M8.8 12h6.4M8.8 15h6.4M8.8 18h4" stroke-linecap="round"/></svg>',
  handoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13M13 4l4 4-4 4"/><path d="M20 16H7M11 12l-4 4 4 4"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H5.5v11h13V10H17"/></svg>',
  import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 17v3.5h14V17"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4.5h4.5M12 7.5V12l3 2"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/></svg>',
  listdoc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7 9h1M7 12h1M7 15h1M10.5 9H17M10.5 12H17M10.5 15H17"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.6l2.2 2.4h8.2A2.5 2.5 0 0 1 22 8.9V18a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h16M4 12h16M4 16h16"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2.5 1.5 21h21zM11 9h2v6h-2zm0 8h2v2h-2z"/></svg>',
};

// MARK: - 主畫面

function render() {
  const app = $('#app');
  app.dataset.view = state.view;
  app.innerHTML = `<section class="pane sidebar">${sidebarHTML()}</section><section class="pane detail">${detailHTML()}</section>`;
  bindSidebar();
  bindDetail();
}

function sidebarHTML() {
  const rows = state.projects.map((p, i) => `
    <button class="list-row ${p.id === state.selectedProjectID && window.innerWidth >= 900 ? 'selected' : ''}" data-project="${esc(p.id)}" data-index="${i}">
      ${state.editProjects ? `<span class="del-dot" data-del-project="${esc(p.id)}" role="button" aria-label="刪除"></span>` : ''}
      <span class="main"><div class="name">${esc(p.name || '未命名專案')}</div><div class="sub">${p.takes.length} 筆 Take</div></span>
      ${state.editProjects ? '' : `<span class="chev">${ICON.chev}</span>`}
    </button>`).join('');

  return `
    <header class="navbar large">
      <div class="left">${state.projects.length ? `<button class="nav-btn" data-act="toggle-edit-projects">${state.editProjects ? '完成' : '編輯'}</button>` : ''}</div>
      <div class="right"><button class="icon-btn" data-act="add-project" aria-label="新增專案">${ICON.plus}</button></div>
      <div class="title">音記表專案</div>
    </header>
    <div class="scroll">
      ${state.projects.length ? `<div class="list-group">${rows}</div>` : `
        <div class="empty"><div class="icon">${ICON.film}</div><h3>還沒有專案</h3><p>按右上角的「＋」建立第一個專案，<br>或從下方匯入交接檔。</p></div>`}
      <div class="section-title">交接與備份</div>
      <div class="list-group">
        <button class="list-row action-row" data-act="import">${ICON.import}<span class="main">匯入交接檔／備份</span></button>
        <button class="list-row action-row" data-act="backup-all" ${state.projects.length ? '' : 'disabled style="opacity:.4"'}>${ICON.archive}<span class="main">備份全部專案</span></button>
        <button class="list-row action-row" data-act="snapshots">${ICON.clock}<span class="main">自動備份紀錄</span></button>
      </div>
      <div class="section-foot">所有資料只存在這支手機上，沒有網路也能使用。建議每天收工時備份一次。<br>聲音報表 v${APP_VERSION}</div>
    </div>`;
}

function bindSidebar() {
  const root = $('.sidebar');
  root.addEventListener('click', e => {
    const del = e.target.closest('[data-del-project]');
    if (del) { e.stopPropagation(); confirmDeleteProject(del.dataset.delProject); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add-project') return openAddProject();
    if (act === 'toggle-edit-projects') { state.editProjects = !state.editProjects; return render(); }
    if (act === 'import') return $('#import-input').click();
    if (act === 'backup-all') return exportAll();
    if (act === 'snapshots') return openSnapshots();
    const row = e.target.closest('[data-project]');
    if (row && !state.editProjects) {
      if (state.selectedProjectID !== row.dataset.project) { state.searchText = ''; state.editTakes = false; }
      state.selectedProjectID = row.dataset.project;
      state.view = 'detail';
      persist();
      render();
      $('.detail .scroll')?.scrollTo(0, 0);
    }
  });
}

// MARK: - 專案內頁

function unbackedCount(p) {
  const since = p.lastBackupAt || 0;
  return p.takes.filter(t => (t.modifiedAt || 0) > since).length;
}

function detailHTML() {
  const p = selectedProject();
  if (!p) {
    return `<header class="navbar"><div class="left"><button class="nav-btn back-btn" data-act="back">${ICON.back}專案</button></div><div class="title"></div><div class="right"></div></header>
      <div class="scroll"><div class="empty"><div class="icon">${ICON.film}</div><h3>請選擇或新增專案</h3><p>從左側列表選擇 A 片、B 片，或建立新專案。</p></div></div>`;
  }
  const loc = p.sessionDefaults.location || '未設定';
  const mixer = p.sessionDefaults.mixer || '未設定';
  const pending = unbackedCount(p);
  return `
    <header class="navbar">
      <div class="left"><button class="nav-btn back-btn" data-act="back">${ICON.back}專案</button></div>
      <div class="title">${esc(p.name || '未命名專案')}</div>
      <div class="right">
        ${p.takes.length ? `<button class="nav-btn" data-act="toggle-edit-takes">${state.editTakes ? '完成' : '編輯'}</button>` : ''}
        <button class="icon-btn" data-act="handoff" aria-label="交接與備份">${ICON.handoff}</button>
        <button class="icon-btn" data-act="pdf" aria-label="匯出 PDF">${ICON.pdf}</button>
      </div>
    </header>
    <div class="detail-top">
      <div class="status-bar">
        <div class="l1">🎬 片名: ${esc(p.info.title || '未設定')}  |  📍 地點: ${esc(loc)}  |  🎙 錄音: ${esc(mixer)}${p.sessionDefaults.boom ? `  |  收音: ${esc(p.sessionDefaults.boom)}` : ''}</div>
        <div class="l2">🎥 當前鏡位: 場 ${esc(p.currentScene)} / 鏡 ${esc(p.currentShot)} (${esc(p.currentSize)})  |  下一 Take: ${p.currentTakeNumber}</div>
        ${pending ? `<button class="warn" data-act="handoff">${ICON.warn}有 ${pending} 筆 Take 尚未備份，點這裡備份</button>` : ''}
      </div>
      <div class="big-buttons">
        <button class="big-btn purple" data-act="info">[1] 🎬 專案資訊</button>
        <button class="big-btn orange" data-act="session">[2] 📍 換日 / 換景點 / 錄音組</button>
        <button class="big-btn blue" data-act="setup">[3] 🎥 換鏡位 / 軌道配置</button>
        <button class="big-btn red tall" data-act="new-take">[4] 🔴 錄製新 Take</button>
      </div>
      ${p.takes.length ? `
        <div class="search-wrap"><label class="search">${ICON.search}
          <input id="search" type="search" placeholder="搜尋 場 / 鏡 / 次 / 流水號 / 備註" value="${esc(state.searchText)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
          <button class="clear ${state.searchText ? '' : 'hidden'}" data-act="clear-search" aria-label="清除">✕</button></label></div>` : ''}
    </div>
    <div class="scroll" id="detail-scroll">
      ${p.takes.length ? `<div id="takes-area">${takesHTML(p)}</div>`
      : `<div class="empty"><div class="icon">${ICON.listdoc}</div><h3>尚無 Take 紀錄</h3><p>按下「錄製新 Take」開始記錄。</p></div>`}
    </div>`;
}

function takesHTML(p) {
  const filtered = filterTakes(p.takes, state.searchText);
  const searching = state.searchText.trim() !== '';
  if (!filtered.length) return `<div class="empty" style="padding-top:36px"><h3>找不到符合的 Take</h3><p>試試「12 3」（場 鏡）、「12-3-2」（場 鏡 次）或「#45」（流水號）。</p></div>`;
  const ctxById = new Map();
  const ctxs = allContexts(p.takes);
  p.takes.forEach((t, i) => ctxById.set(t.id, ctxs[i]));
  const editing = state.editTakes && !searching;

  let html = '';
  if (state.editTakes && searching) html += `<div class="hint">搜尋時無法排序或刪除，請先清除搜尋。</div>`;
  if (editing) html += `<div class="hint">按住右側「≡」拖曳可調整順序；拖到別組會自動改成那組的日期、地點與錄音組。</div>`;
  html += `<div class="takes" id="takes">`;
  for (const g of groupTakes(filtered)) {
    html += `<div class="group-header" data-header data-date="${esc(g.date)}" data-location="${esc(g.location)}" data-mixer="${esc(g.mixer)}">
      <span class="folder">${ICON.folder}</span><span class="date">${esc(g.date || '未設定日期')}</span>
      <span class="rest">︱📍 地點：${esc(g.location || '未設定地點')}${g.mixer ? `︱🎙 ${esc(g.mixer)}` : ''}</span></div>`;
    g.takes.forEach((t, idx) => {
      const ctx = ctxById.get(t.id);
      const first = isFirstTakeOfShot(t);
      const serial = t.useSerialNumber && t.idNum != null ? `<span class="badge-serial">#${t.idNum}</span>` : '';
      const sceneShot = first ? `場 ${esc(t.scene)} / 鏡 ${esc(t.shot)}` : `場 ${esc(ctx.scene)} / 鏡 ${esc(ctx.shot)}`;
      const sizeTag = t.size ? `<span class="badge-size">${esc(t.size)}</span>` : '';
      const content = t.content ? `<span class="content">${esc(t.content)}</span>` : '';
      html += `<div class="take-row ${idx === 0 ? 'first' : ''} ${idx === g.takes.length - 1 ? 'last' : ''} ${editing ? 'editing' : ''}" data-take="${esc(t.id)}">
        <button class="swipe-del" data-del-take="${esc(t.id)}" tabindex="-1">刪除</button>
        <div class="take-inner">
          ${editing ? `<button class="del-dot" data-del-take="${esc(t.id)}" aria-label="刪除"></button>` : ''}
          <div class="main">
            <div class="l1">${serial}<span>Take ${esc(t.take)}</span><span class="dot">•</span><span>${sceneShot}</span></div>
            <div class="l2">${sizeTag}${content}</div>
          </div>
          ${editing ? `<span class="drag-handle" aria-label="拖曳排序">${ICON.grip}</span>` : `<span class="chev">${ICON.chev}</span>`}
        </div>
      </div>`;
    });
  }
  html += `</div>`;
  return html;
}

function refreshTakes() {
  const p = selectedProject();
  const area = $('#takes-area');
  if (p && area) area.innerHTML = takesHTML(p);
  $('.search .clear')?.classList.toggle('hidden', !state.searchText);
}

function bindDetail() {
  const root = $('.detail');
  root.addEventListener('click', e => {
    const p = selectedProject();
    const delTake = e.target.closest('[data-del-take]');
    if (delTake) { e.stopPropagation(); confirmDeleteTake(delTake.dataset.delTake); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    switch (act) {
      case 'back': state.view = 'list'; state.editTakes = false; return render();
      case 'pdf': return openPDF();
      case 'handoff': return openHandoff();
      case 'toggle-edit-takes': state.editTakes = !state.editTakes; return refreshDetailKeepScroll();
      case 'info': return openProjectInfo();
      case 'session': return openSession();
      case 'setup': return openSetup();
      case 'new-take': return openTakeForm({ mode: 'create' });
      case 'clear-search': state.searchText = ''; $('#search').value = ''; return refreshTakes();
    }
    if (gesture.suppressClick) { gesture.suppressClick = false; return; }
    if (closeOpenSwipe()) return;
    const row = e.target.closest('[data-take]');
    if (row && p && !(state.editTakes && !state.searchText.trim())) {
      const take = p.takes.find(t => t.id === row.dataset.take);
      if (take) openTakeForm({ mode: 'edit', take });
    }
  });
  const search = $('#search');
  search?.addEventListener('input', () => { state.searchText = search.value; refreshTakes(); });
  root.addEventListener('pointerdown', onDragStart);
  $('#detail-scroll')?.addEventListener('pointerdown', onRowPointerDown);
}

function refreshDetailKeepScroll() {
  const y = $('#detail-scroll')?.scrollTop || 0;
  render();
  const s = $('#detail-scroll'); if (s) s.scrollTop = y;
}

// MARK: - 拖曳排序（全局跨 Header）

let drag = null;

function onDragStart(e) {
  const handle = e.target.closest('.drag-handle');
  if (!handle) return;
  e.preventDefault();
  beginDrag(handle.closest('.take-row'), e);
}

function beginDrag(row, e) {
  closeOpenSwipe();
  const scroller = $('#detail-scroll');
  drag = { row, scroller, pointerId: e.pointerId, y: e.clientY, raf: 0 };
  row.classList.add('dragging');
  try { navigator.vibrate?.(10); } catch {}
  // 監聽整個視窗：拖曳中這一列會在 DOM 裡移動位置，不能只綁在把手上
  window.addEventListener('pointermove', onDragMove, { passive: false });
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
  window.addEventListener('touchmove', preventScroll, { passive: false });
  const loop = () => {
    if (!drag) return;
    const r = scroller.getBoundingClientRect();
    const edge = 70;
    let dy = 0;
    if (drag.y < r.top + edge) dy = -Math.ceil((r.top + edge - drag.y) / 6);
    else if (drag.y > r.bottom - edge) dy = Math.ceil((drag.y - (r.bottom - edge)) / 6);
    if (dy) { scroller.scrollTop += dy; placeDragged(); }
    drag.raf = requestAnimationFrame(loop);
  };
  drag.raf = requestAnimationFrame(loop);
}

function preventScroll(e) { if (drag) e.preventDefault(); }

function onDragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  e.preventDefault();
  drag.y = e.clientY;
  placeDragged();
}

function placeDragged() {
  const { row, y } = drag;
  const container = row.parentElement;
  const items = [...container.children].filter(el => el !== row);
  let before = null;
  for (const el of items) {
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height / 2) { before = el; break; }
  }
  // 不能放在第一個日期標題之前
  if (before === items[0]) before = items[1] || null;
  if (before) { if (row.nextElementSibling !== before) container.insertBefore(row, before); }
  else if (container.lastElementChild !== row) container.appendChild(row);
}

function onDragEnd(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);
  window.removeEventListener('touchmove', preventScroll);
  cancelAnimationFrame(drag.raf);
  const movedId = drag.row.dataset.take;
  const container = drag.row.parentElement;
  drag.row.classList.remove('dragging');
  drag = null;
  gesture.suppressClick = true;
  setTimeout(() => { gesture.suppressClick = false; }, 400);

  const p = selectedProject();
  if (!p) return;
  const byId = new Map(p.takes.map(t => [t.id, t]));
  let header = null, movedHeader = null;
  const order = [];
  for (const el of container.children) {
    if (el.hasAttribute('data-header')) { header = el.dataset; continue; }
    const id = el.dataset.take;
    if (byId.has(id)) order.push(id);
    if (id === movedId) movedHeader = header;
  }
  if (order.length !== p.takes.length) return refreshDetailKeepScroll();
  const changed = order.some((id, i) => p.takes[i].id !== id);
  p.takes = order.map(id => byId.get(id));
  // 移動後的 Take 自動繼承所在分組的日期、地點、錄音師
  const moved = byId.get(movedId);
  if (moved && movedHeader && (moved.date !== movedHeader.date || moved.location !== movedHeader.location || moved.mixer !== movedHeader.mixer)) {
    moved.date = movedHeader.date; moved.location = movedHeader.location; moved.mixer = movedHeader.mixer;
    // 收音助理跟著同組相鄰的 Take
    const idx = p.takes.indexOf(moved);
    const neighbor = [p.takes[idx - 1], p.takes[idx + 1]].find(t => t && t.date === moved.date && t.location === moved.location && t.mixer === moved.mixer);
    if (neighbor) moved.boom = neighbor.boom;
    moved.modifiedAt = Date.now();
  } else if (changed && moved) moved.modifiedAt = Date.now();
  touch(p);
  refreshDetailKeepScroll();
}

// MARK: - 手勢：左滑刪除、長按拖動（手機）、直接拖動（滑鼠）

const gesture = { suppressClick: false, openRow: null };
const LONG_PRESS_MS = 420;
const SWIPE_W = 88;

function closeOpenSwipe() {
  const r = gesture.openRow;
  if (!r) return false;
  gesture.openRow = null;
  const inner = $('.take-inner', r);
  if (inner) { inner.style.transition = 'transform .2s ease'; inner.style.transform = ''; }
  r.classList.remove('swiped');
  return true;
}

function onRowPointerDown(e) {
  if (drag || e.button > 0) return;
  if (e.target.closest('.drag-handle, .del-dot, .swipe-del')) return;
  const row = e.target.closest('.take-row');
  if (!row) return;
  const searching = state.searchText.trim() !== '';
  const inner = $('.take-inner', row);
  const startX = e.clientX, startY = e.clientY, id = e.pointerId;
  const wasOpen = gesture.openRow === row;
  if (gesture.openRow && !wasOpen) closeOpenSwipe();
  let mode = 'pending'; // pending | swipe | drag | scroll
  let timer = null;

  if (!searching && e.pointerType !== 'mouse') {
    timer = setTimeout(() => {
      if (mode !== 'pending') return;
      mode = 'drag';
      cleanup();
      beginDrag(row, { pointerId: id, clientY: startY });
    }, LONG_PRESS_MS);
  }

  const move = ev => {
    if (ev.pointerId !== id) return;
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (mode === 'pending') {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        mode = 'swipe'; clearTimeout(timer);
        inner.style.transition = 'none';
      } else if (Math.abs(dy) > 6) {
        clearTimeout(timer);
        if (e.pointerType === 'mouse' && !searching) { mode = 'drag'; cleanup(); beginDrag(row, ev); return; }
        mode = 'scroll'; cleanup(); return;
      } else return;
    }
    if (mode === 'swipe') {
      ev.preventDefault();
      const base = wasOpen ? -SWIPE_W : 0;
      const x = Math.min(0, base + dx);
      inner.style.transform = `translateX(${x}px)`;
      row.classList.toggle('swiped', x < -4);
    }
  };
  const up = ev => {
    if (ev.pointerId !== id) return;
    clearTimeout(timer);
    cleanup();
    if (mode !== 'swipe') return;
    gesture.suppressClick = true;
    setTimeout(() => { gesture.suppressClick = false; }, 300);
    const dx = ev.clientX - startX;
    const x = Math.min(0, (wasOpen ? -SWIPE_W : 0) + dx);
    inner.style.transition = 'transform .2s ease';
    if (x < -row.offsetWidth * 0.6) {
      // 一路滑到底：直接問要不要刪除
      inner.style.transform = '';
      row.classList.remove('swiped');
      gesture.openRow = null;
      confirmDeleteTake(row.dataset.take);
    } else if (x < -SWIPE_W / 2) {
      inner.style.transform = `translateX(${-SWIPE_W}px)`;
      row.classList.add('swiped');
      gesture.openRow = row;
    } else {
      inner.style.transform = '';
      row.classList.remove('swiped');
      gesture.openRow = null;
    }
  };
  const blockScroll = ev => { if (mode === 'swipe') ev.preventDefault(); };
  function cleanup() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    row.removeEventListener('touchmove', blockScroll);
  }
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  row.addEventListener('touchmove', blockScroll, { passive: false });
}

// MARK: - Sheet 與對話框

let sheetOnClose = null;

function openSheet({ title, left, right, body, onMount, dismissOnBackdrop = true, onBackdrop }) {
  const root = $('#sheet-root');
  root.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="navbar">
        <div class="left">${left ? `<button class="nav-btn ${left.bold ? 'bold' : ''}" data-sheet="left">${left.label}</button>` : ''}</div>
        <div class="title">${esc(title)}</div>
        <div class="right">${right ? `<button class="nav-btn ${right.bold ? 'bold' : ''}" data-sheet="right" ${right.disabled ? 'disabled' : ''}>${right.label}</button>` : ''}</div>
      </header>
      <div class="scroll sheet-body">${body}</div>
    </div>`;
  const sheet = $('.sheet', root);
  const bodyEl = $('.sheet-body', sheet);
  bodyEl.addEventListener('scroll', () => $('.navbar', sheet).classList.toggle('scrolled', bodyEl.scrollTop > 2));
  $('[data-sheet="left"]', sheet)?.addEventListener('click', () => left.action());
  $('[data-sheet="right"]', sheet)?.addEventListener('click', () => right.action());
  $('.sheet-backdrop', root).addEventListener('click', () => {
    if (onBackdrop) onBackdrop();
    else if (dismissOnBackdrop) closeSheet();
  });
  sheetOnClose = null;
  onMount?.(sheet, bodyEl);
  return sheet;
}

function closeSheet() {
  const cb = sheetOnClose; sheetOnClose = null;
  $('#sheet-root').innerHTML = '';
  cb?.();
}

function showDialog({ title, message = '', buttons, vertical = false }) {
  return new Promise(resolve => {
    const root = $('#dialog-root');
    root.innerHTML = `<div class="dialog-backdrop"><div class="dialog" role="alertdialog">
      <div class="body"><h4>${esc(title)}</h4>${message ? `<p>${esc(message)}</p>` : ''}</div>
      <div class="btns ${vertical || buttons.length > 2 ? 'vertical' : ''}">
        ${buttons.map((b, i) => `<button data-i="${i}" class="${b.style || ''}">${esc(b.label)}</button>`).join('')}
      </div></div></div>`;
    $$('button', root).forEach(btn => btn.addEventListener('click', () => {
      root.innerHTML = '';
      resolve(+btn.dataset.i);
    }));
  });
}

let toastTimer = null;
function toast(message, action) {
  const root = $('#toast-root');
  root.innerHTML = `<div class="toast"><span>${esc(message)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}</div>`;
  if (action) $('button', root).addEventListener('click', () => { root.innerHTML = ''; action.run(); });
  clearTimeout(toastTimer);
  if (!action?.sticky) toastTimer = setTimeout(() => { root.innerHTML = ''; }, 3200);
}

const switchHTML = (id, on) => `<span class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></span>`;
const textField = (id, label, value, placeholder = '', attrs = '') =>
  `<div class="field">${label ? `<label for="${id}">${esc(label)}</label>` : ''}<input type="text" id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" ${attrs}></div>`;
const plainField = (id, value, placeholder, attrs = '') =>
  `<div class="field"><input type="text" id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" ${attrs}></div>`;

/** 把輸入框直接綁到物件欄位（原版 SwiftUI 的 Binding） */
function bindInputs(root, target, map, onChange) {
  for (const [id, key] of Object.entries(map)) {
    const el = $(`#${id}`, root);
    if (!el) continue;
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      target[key] = el.type === 'checkbox' ? el.checked : el.value;
      onChange?.(key);
    });
  }
}

function tracksFieldsHTML(prefix, tracks) {
  return tracks.map((t, i) => `
    <div class="field track"><span class="tr">Tr${i + 1}</span>
      <input type="text" id="${prefix}-name-${i}" value="${esc(t.name)}" placeholder="名稱" autocomplete="off">
      ${switchHTML(`${prefix}-on-${i}`, t.isActive)}</div>`).join('');
}

function bindTracks(root, prefix, tracks, onChange) {
  tracks.forEach((t, i) => {
    $(`#${prefix}-name-${i}`, root).addEventListener('input', e => { t.name = e.target.value; onChange?.(); });
    $(`#${prefix}-on-${i}`, root).addEventListener('change', e => { t.isActive = e.target.checked; onChange?.(); });
  });
}

// MARK: - 新增／刪除專案

function openAddProject() {
  let name = '';
  const sheet = openSheet({
    title: '新增專案',
    left: { label: '取消', action: closeSheet },
    right: { label: '建立', bold: true, disabled: true, action: create },
    body: `<div class="form"><div class="section-title">　</div><div class="form-group">${plainField('np-name', '', '專案名稱', 'enterkeyhint="done"')}</div></div>`,
  });
  const input = $('#np-name', sheet);
  const btn = $('[data-sheet="right"]', sheet);
  input.addEventListener('input', () => { name = input.value; btn.disabled = !name.trim(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  setTimeout(() => input.focus(), 250);
  function create() {
    const n = name.trim();
    if (!n) return;
    const p = newProject(n);
    state.projects.push(p);
    state.selectedProjectID = p.id;
    state.view = 'detail';
    state.searchText = '';
    state.editTakes = false;
    touch(p);
    closeSheet();
    render();
  }
}

async function confirmDeleteProject(id) {
  const p = state.projects.find(x => x.id === id);
  if (!p) return;
  const i = await showDialog({
    title: `確定要刪除「${p.name || '未命名專案'}」這個專案嗎？`,
    message: '專案內所有的 Take 將會一併刪除。App 會先自動備份一份，必要時可在「自動備份紀錄」還原。',
    buttons: [{ label: '刪除', style: 'destructive' }, { label: '取消', style: 'bold' }],
  });
  if (i !== 0) return;
  try { await addSnapshot(p, '刪除專案前'); } catch (e) { console.error(e); }
  state.projects = state.projects.filter(x => x.id !== id);
  if (state.selectedProjectID === id) state.selectedProjectID = state.projects[0]?.id || null;
  if (!state.projects.length) state.editProjects = false;
  persist();
  render();
}

// MARK: - [1] 專案資訊

function openProjectInfo() {
  const p = selectedProject();
  const done = () => { touch(p); closeSheet(); render(); };
  const sheet = openSheet({
    title: '專案資訊',
    right: { label: '完成', bold: true, action: done },
    onBackdrop: done,
    body: `<div class="form">
      <div class="section-title">專案名稱</div>
      <div class="form-group">${plainField('pi-name', p.name, '例: A片')}</div>
      <div class="section-title">全片資訊 (填一次)</div>
      <div class="form-group">
        ${plainField('pi-title', p.info.title, '片名')}
        ${plainField('pi-director', p.info.director, '導演')}
        ${plainField('pi-producer', p.info.producer, '製片')}
      </div>
      <div class="section-foot">錄音師與收音助理請在「[2] 換日 / 換景點 / 錄音組」填寫。</div>
      <div class="section-title">流水號預設</div>
      <div class="form-group"><div class="field"><label class="lbl-flex" for="pi-serial">預設使用流水號</label>${switchHTML('pi-serial', p.useSerialNumber)}</div></div>
    </div>`,
  });
  bindInputs(sheet, p, { 'pi-name': 'name', 'pi-serial': 'useSerialNumber' }, () => touch(p));
  bindInputs(sheet, p.info, { 'pi-title': 'title', 'pi-director': 'director', 'pi-producer': 'producer' }, () => touch(p));
}

// MARK: - [2] 換日 / 換景點 / 錄音師

function openSession(opts = {}) {
  const p = selectedProject();
  const done = () => { touch(p); closeSheet(); render(); };
  const sheet = openSheet({
    title: '換日 / 換景點 / 錄音組',
    right: { label: '完成', bold: true, action: done },
    onBackdrop: done,
    body: `<div class="form">
      ${opts.notice ? `<div class="notice blue">${opts.notice}</div>` : ''}
      <div class="section-title">拍攝環境 (後續 Take 預設)</div>
      <div class="form-group">
        <div class="field"><label for="ss-date">拍攝日期</label><input type="date" id="ss-date" value="${esc(p.sessionDefaults.date)}"></div>
        ${plainField('ss-location', p.sessionDefaults.location, '拍攝地點')}
        ${plainField('ss-sd', p.sessionDefaults.sdFolder, 'SD 卡 Folder 卡號')}
      </div>
      <div class="section-title">錄音組</div>
      <div class="form-group">
        ${textField('ss-mixer', '錄音師', p.sessionDefaults.mixer)}
        ${textField('ss-boom', '收音', p.sessionDefaults.boom, '收音助理，多人用「、」隔開')}
      </div>
      <div class="section-foot">日期、地點或錄音師改變時，PDF 會自動換頁。收音助理每天可以不同、不會換頁；同一位錄音師連續負責的頁面，會合併顯示這段期間所有的收音助理。</div>
      <div style="margin-top:14px"></div>
      <div class="form-group"><button class="field" style="width:100%;color:var(--blue)" id="ss-today">日期設為今天</button></div>
    </div>`,
  });
  bindInputs(sheet, p.sessionDefaults, { 'ss-date': 'date', 'ss-location': 'location', 'ss-sd': 'sdFolder', 'ss-mixer': 'mixer', 'ss-boom': 'boom' }, () => touch(p));
  $('#ss-today', sheet).addEventListener('click', () => {
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    p.sessionDefaults.date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    $('#ss-date', sheet).value = p.sessionDefaults.date;
    touch(p);
  });
}

// MARK: - [3] 換鏡位 / 軌道配置

function openSetup() {
  const p = selectedProject();
  // 原版：關閉時保留修改（不換鏡、不重設 Take 次數）；按「套用新鏡位」才算新鏡位
  const close = () => { touch(p); closeSheet(); render(); };
  const apply = () => {
    p.isNewShot = true;
    // 這個場鏡之前拍過，就接著上次的次數；沒拍過從 1 開始（錄製時仍可手動改）
    const next = nextTakeNumberFor(p.takes, p.currentScene, p.currentShot);
    p.currentTakeNumber = next ?? 1;
    close();
    if (next) toast(`場 ${p.currentScene} / 鏡 ${p.currentShot} 之前拍到 Take ${next - 1}，下一個是 Take ${next}`);
  };
  const sheet = openSheet({
    title: '換鏡位 / 軌道',
    left: { label: '關閉', action: close },
    right: { label: '套用新鏡位', bold: true, action: apply },
    onBackdrop: close,
    body: `<div class="form">
      <div class="section-title">新鏡位資訊</div>
      <div class="form-group">
        ${plainField('su-scene', p.currentScene, '場 (Scene)')}
        ${plainField('su-shot', p.currentShot, '鏡 (Shot)')}
        ${plainField('su-size', p.currentSize, 'Size (CU/MCU/WS)', 'autocapitalize="characters"')}
      </div>
      <div class="section-title">軌道名稱與啟用 (Tr1 ~ Tr8)</div>
      <div class="form-group">${tracksFieldsHTML('su', p.currentTracks)}</div>
      <div class="section-foot">「套用新鏡位」會從 Take 1 開始；如果這個場鏡之前拍過，會自動接著上次的次數。只想臨時改軌道或 Size、不換鏡，按「關閉」即可。</div>
    </div>`,
  });
  bindInputs(sheet, p, { 'su-scene': 'currentScene', 'su-shot': 'currentShot', 'su-size': 'currentSize' }, () => touch(p));
  bindTracks(sheet, 'su', p.currentTracks, () => touch(p));
}

// MARK: - [4] 錄製新 Take／編輯 Take

function openTakeForm({ mode, take: original }) {
  const p = selectedProject();
  const d = {
    useSerialNumber: true, idNumText: '', scene: '', shot: '', take: '', size: '',
    tracks: [], content: '', note: '', date: '', location: '', sdFolder: '', mixer: '', boom: '', isFirstTakeOfShot: true,
  };

  if (mode === 'create') {
    d.useSerialNumber = p.useSerialNumber;
    d.idNumText = p.useSerialNumber ? String(p.nextSerialNumber) : '';
    d.isFirstTakeOfShot = p.isNewShot;
    d.scene = p.currentScene; d.shot = p.currentShot; d.size = p.currentSize;
    d.tracks = cloneTracks(p.currentTracks);
    d.take = String(p.currentTakeNumber);
    d.date = p.sessionDefaults.date; d.location = p.sessionDefaults.location;
    d.sdFolder = p.sessionDefaults.sdFolder; d.mixer = p.sessionDefaults.mixer; d.boom = p.sessionDefaults.boom;
  } else {
    const r = original;
    d.useSerialNumber = r.useSerialNumber;
    d.idNumText = r.idNum != null ? String(r.idNum) : '';
    d.isFirstTakeOfShot = isFirstTakeOfShot(r);
    const index = p.takes.findIndex(t => t.id === r.id);
    if (index >= 0) {
      const ctx = effectiveContext(p.takes, index);
      d.scene = d.isFirstTakeOfShot ? r.scene : ctx.scene;
      d.shot = d.isFirstTakeOfShot ? r.shot : ctx.shot;
      d.size = d.isFirstTakeOfShot ? r.size : ctx.size;
    } else { d.scene = r.scene; d.shot = r.shot; d.size = r.size; }
    d.take = r.take; d.tracks = cloneTracks(r.tracks);
    d.content = r.content; d.note = r.note;
    d.date = r.date; d.location = r.location; d.sdFolder = r.sdFolder; d.mixer = r.mixer; d.boom = r.boom;
  }

  const isEdit = mode === 'edit';
  let dirty = false;

  const sheet = openSheet({
    title: isEdit ? '編輯 Take' : '錄製新 Take',
    left: { label: '取消', action: cancel },
    right: { label: '儲存', bold: true, action: save },
    onBackdrop: cancel,
    body: '<div class="form" id="tf"></div>',
  });
  const formEl = $('#tf', sheet);

  function bodyHTML() {
    const sceneShot = d.isFirstTakeOfShot
      ? `${plainField('tf-scene', d.scene, '場 (Scene)')}${plainField('tf-shot', d.shot, '鏡 (Shot)')}`
      : `<div class="field"><span>場</span><span class="value">${esc(d.scene)}</span></div><div class="field"><span>鏡</span><span class="value">${esc(d.shot)}</span></div>`;
    return `
      <div class="section-title">流水號 | 場 | 鏡 | 次 | Size</div>
      <div class="form-group">
        <div class="field"><label class="lbl-flex" for="tf-useserial">使用流水號</label>${switchHTML('tf-useserial', d.useSerialNumber)}</div>
        ${d.useSerialNumber ? plainField('tf-idnum', d.idNumText, '流水號', 'inputmode="numeric" pattern="[0-9]*"') : ''}
        ${isEdit ? `<div class="field"><label class="lbl-flex" for="tf-first">此 Take 為新鏡第一拍</label>${switchHTML('tf-first', d.isFirstTakeOfShot)}</div>` : ''}
        ${sceneShot}
        ${plainField('tf-take', d.take, '次 (Take)', 'inputmode="numeric"')}
        ${textField('tf-size', 'Size', d.size, 'Size', 'autocapitalize="characters"')}
      </div>
      <div class="section-title">軌道 (Tr1 ~ Tr8)</div>
      <div class="form-group">${tracksFieldsHTML('tf', d.tracks)}</div>
      <div class="section-title">內容</div>
      <div class="form-group">
        <div class="field"><textarea id="tf-content" rows="3" placeholder="內容描述">${esc(d.content)}</textarea></div>
        <div class="field"><textarea id="tf-note" rows="2" placeholder="備註">${esc(d.note)}</textarea></div>
      </div>
      ${isEdit ? `
        <div class="section-title">環境 (日期、地點、錄音師會影響 PDF 分頁)</div>
        <div class="form-group">
          ${textField('tf-date', '日期', d.date, 'yyyy-MM-dd', 'inputmode="numeric"')}
          ${textField('tf-location', '地點', d.location)}
          ${textField('tf-sd', 'SD Folder', d.sdFolder)}
          ${textField('tf-mixer', '錄音師', d.mixer)}
          ${textField('tf-boom', '收音', d.boom)}
        </div>
        <button class="danger-btn" id="tf-delete">刪除這筆 Take</button>` : ''}`;
  }

  function mount() {
    formEl.innerHTML = bodyHTML();
    const mark = () => { dirty = true; };
    bindInputs(formEl, d, {
      'tf-idnum': 'idNumText', 'tf-scene': 'scene', 'tf-shot': 'shot', 'tf-take': 'take', 'tf-size': 'size',
      'tf-content': 'content', 'tf-note': 'note', 'tf-date': 'date', 'tf-location': 'location', 'tf-sd': 'sdFolder', 'tf-mixer': 'mixer', 'tf-boom': 'boom',
    }, mark);
    bindTracks(formEl, 'tf', d.tracks, mark);
    $('#tf-useserial', formEl).addEventListener('change', e => { d.useSerialNumber = e.target.checked; dirty = true; mount(); });
    $('#tf-first', formEl)?.addEventListener('change', e => { d.isFirstTakeOfShot = e.target.checked; dirty = true; mount(); });
    $('#tf-delete', formEl)?.addEventListener('click', async () => {
      if (await confirmDeleteTake(original.id)) closeSheet();
    });
  }
  mount();

  async function cancel() {
    if (dirty) {
      const i = await showDialog({ title: '要放棄這次的修改嗎？', buttons: [{ label: '放棄修改', style: 'destructive' }, { label: '繼續編輯', style: 'bold' }] });
      if (i !== 0) return;
    }
    closeSheet();
  }

  function save() {
    const trimmed = d.idNumText.trim();
    const parsedID = /^-?\d+$/.test(trimmed) ? parseInt(trimmed, 10) : null;
    const now = Date.now();

    if (!isEdit) {
      const record = newTake();
      record.useSerialNumber = d.useSerialNumber;
      record.idNum = d.useSerialNumber ? (parsedID ?? p.nextSerialNumber) : null;
      record.take = d.take;
      record.content = d.content;
      record.note = d.note;
      record.date = p.sessionDefaults.date;
      record.location = p.sessionDefaults.location;
      record.sdFolder = p.sessionDefaults.sdFolder;
      record.mixer = p.sessionDefaults.mixer;
      record.boom = p.sessionDefaults.boom;
      record.tracks = cloneTracks(d.tracks);
      record.modifiedAt = now;

      if (d.isFirstTakeOfShot) {
        record.scene = d.scene; record.shot = d.shot; record.size = d.size;
        p.currentScene = d.scene; p.currentShot = d.shot; p.currentSize = d.size;
        p.currentTracks = cloneTracks(d.tracks);
      } else {
        record.scene = ''; record.shot = '';
        // 同鏡中途改 Size：只有和前一筆不同時才記下來
        const prevSize = p.takes.length ? effectiveContext(p.takes, p.takes.length - 1).size : '';
        record.size = d.size !== prevSize ? d.size : '';
        p.currentSize = d.size;
        p.currentTracks = cloneTracks(d.tracks);
      }
      p.takes.push(record);

      if (d.useSerialNumber) {
        const used = record.idNum ?? p.nextSerialNumber;
        p.nextSerialNumber = Math.max(p.nextSerialNumber, used + 1);
      }
      const takeNum = /^-?\d+$/.test(d.take.trim()) ? parseInt(d.take.trim(), 10) : null;
      p.currentTakeNumber = takeNum != null ? takeNum + 1 : p.currentTakeNumber + 1;
      p.isNewShot = false;
      p.useSerialNumber = d.useSerialNumber;
    } else {
      const index = p.takes.findIndex(t => t.id === original.id);
      if (index < 0) return closeSheet();
      const u = { ...p.takes[index] };
      u.useSerialNumber = d.useSerialNumber;
      u.idNum = d.useSerialNumber ? parsedID : null;
      u.take = d.take; u.content = d.content; u.note = d.note;
      u.date = d.date; u.location = d.location; u.sdFolder = d.sdFolder; u.mixer = d.mixer; u.boom = d.boom;
      u.tracks = cloneTracks(d.tracks);
      if (d.isFirstTakeOfShot) { u.scene = d.scene; u.shot = d.shot; u.size = d.size; }
      else {
        u.scene = ''; u.shot = '';
        const prevSize = index > 0 ? effectiveContext(p.takes, index - 1).size : '';
        u.size = d.size !== prevSize ? d.size : '';
      }
      u.modifiedAt = now;
      p.takes[index] = u;
      if (d.useSerialNumber && u.idNum != null) p.nextSerialNumber = Math.max(p.nextSerialNumber, u.idNum + 1);
    }
    touch(p);
    closeSheet();
    refreshDetailKeepScroll();
    if (!isEdit) requestAnimationFrame(() => {
      const s = $('#detail-scroll');
      if (s && !state.searchText) s.scrollTop = s.scrollHeight;
    });
  }
}

async function confirmDeleteTake(id) {
  const p = selectedProject();
  const take = p?.takes.find(t => t.id === id);
  if (!take) return false;
  const i = await showDialog({
    title: `確定要刪除「Take ${take.take}」嗎？`,
    message: '刪除後將無法復原。',
    buttons: [{ label: '刪除', style: 'destructive' }, { label: '取消', style: 'bold' }],
  });
  if (i !== 0) return false;
  p.takes = p.takes.filter(t => t.id !== id);
  touch(p);
  refreshDetailKeepScroll();
  return true;
}

// MARK: - PDF 匯出與預覽

async function openPDF() {
  const p = selectedProject();
  let result = null;
  const fileName = `${safeFileName(p.info.title || p.name)}_聲音報表_${stamp()}.pdf`;
  let viewer = null;
  const cleanup = () => { result?.previews.forEach(u => URL.revokeObjectURL(u)); viewer?.destroy(); };
  const sheet = openSheet({
    title: '聲音報告預覽',
    left: { label: '關閉', action: () => { cleanup(); closeSheet(); } },
    right: { label: `${ICON.share}`, action: share },
    onBackdrop: () => { cleanup(); closeSheet(); },
    body: `<div class="progress" id="pdf-progress">正在產生 PDF…<div class="bar"><i></i></div></div><div class="pdf-pages hidden" id="pdf-pages"><div class="pdf-inner"></div></div><div class="pdf-hint hidden" id="pdf-hint">雙指縮放或點兩下放大</div>`,
  });
  $('.sheet-body', sheet).classList.add('pdf-body');
  const shareBtn = $('[data-sheet="right"]', sheet);
  shareBtn.disabled = true;
  shareBtn.setAttribute('aria-label', '分享 PDF');
  try {
    const { generateSoundReport } = await import('./pdf.js');
    result = await generateSoundReport(p, (done, total) => {
      const bar = $('#pdf-progress i', sheet);
      if (bar) bar.style.width = `${Math.round(done / total * 100)}%`;
    });
    if (!document.body.contains(sheet)) return cleanup();
    $('#pdf-progress', sheet).classList.add('hidden');
    const pages = $('#pdf-pages', sheet);
    pages.classList.remove('hidden');
    $('#pdf-hint', sheet).classList.remove('hidden');
    setTimeout(() => $('#pdf-hint', sheet)?.classList.add('fade'), 2500);
    $('.pdf-inner', pages).innerHTML = result.previews.map((u, i) => `<img src="${u}" alt="第 ${i + 1} 頁" data-i="${i}" draggable="false">`).join('');
    viewer = createZoomViewer(pages, result);
    shareBtn.disabled = false;
  } catch (e) {
    console.error(e);
    $('#pdf-progress', sheet).textContent = `產生 PDF 時發生錯誤：${e.message || e}`;
  }

  async function share() {
    if (!result) return;
    const file = new File([result.blob], fileName, { type: 'application/pdf' });
    await shareFile(file);
  }
}

// MARK: - PDF 預覽縮放（只縮放 PDF，不縮放整個畫面；放大後重新畫成高解析度）

function createZoomViewer(scroller, result) {
  const inner = $('.pdf-inner', scroller);
  const imgs = $$('img', inner);
  const MIN = 1, MAX = 6;
  let zoom = 1;
  let pinch = null;
  let hiresTimer = null;
  const hires = new Map(); // 頁碼 -> { url, width }

  const baseWidth = () => Math.min(scroller.clientWidth - 24, 1000);
  const applyZoom = () => { inner.style.width = `${baseWidth() * zoom}px`; };
  applyZoom();

  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
  // 螢幕座標 → 內容座標（以 .pdf-inner 左上角為原點）
  const toContent = (cx, cy) => {
    const r = inner.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };
  // 讓內容上的某一點 (px, py) 對齊到螢幕位置 (cx, cy)
  const alignPoint = (px, py, cx, cy) => {
    const r = inner.getBoundingClientRect();
    scroller.scrollLeft += (r.left + px) - cx;
    scroller.scrollTop += (r.top + py) - cy;
  };

  function zoomTo(newZoom, cx, cy) {
    newZoom = Math.min(MAX, Math.max(MIN, newZoom));
    const p = toContent(cx, cy);
    const k = newZoom / zoom;
    zoom = newZoom;
    applyZoom();
    alignPoint(p.x * k, p.y * k, cx, cy);
    scheduleHires();
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const m = mid(e.touches[0], e.touches[1]);
      const p = toContent(m.x, m.y);
      pinch = { d0: dist(e.touches[0], e.touches[1]), z0: zoom, m0: m, p, k: 1, m };
      inner.style.transformOrigin = '0 0';
    }
  }
  function onTouchMove(e) {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const m = mid(e.touches[0], e.touches[1]);
    let z = pinch.z0 * dist(e.touches[0], e.touches[1]) / pinch.d0;
    z = Math.min(MAX * 1.15, Math.max(MIN * 0.85, z));
    const k = z / pinch.z0;
    pinch.k = k; pinch.m = m;
    // 手指中間那一點保持在手指下方，同時可以拖著移動
    const tx = pinch.p.x * (1 - k) + (m.x - pinch.m0.x);
    const ty = pinch.p.y * (1 - k) + (m.y - pinch.m0.y);
    inner.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
  }
  function onTouchEnd(e) {
    if (!pinch || e.touches.length >= 2) return;
    const { z0, k, p, m } = pinch;
    pinch = null;
    inner.style.transform = '';
    const target = Math.min(MAX, Math.max(MIN, z0 * k));
    const kk = target / z0;
    zoom = target;
    applyZoom();
    alignPoint(p.x * kk, p.y * kk, m.x, m.y);
    scheduleHires();
  }

  // 點兩下：放大到 2.5 倍／縮回原尺寸
  let lastTap = 0, lastXY = null;
  function onTap(e) {
    if (e.pointerType === 'mouse') return;
    const now = Date.now();
    if (now - lastTap < 300 && lastXY && Math.hypot(e.clientX - lastXY.x, e.clientY - lastXY.y) < 30) {
      zoomTo(zoom > 1.2 ? 1 : 2.5, e.clientX, e.clientY);
      lastTap = 0;
    } else { lastTap = now; lastXY = { x: e.clientX, y: e.clientY }; }
  }
  // 電腦：Ctrl＋滾輪，或觸控板雙指縮放
  function onWheel(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomTo(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
  }

  function scheduleHires() {
    clearTimeout(hiresTimer);
    hiresTimer = setTimeout(updateHires, 250);
  }
  async function updateHires() {
    const dpr = window.devicePixelRatio || 1;
    const view = scroller.getBoundingClientRect();
    for (const img of imgs) {
      const i = +img.dataset.i;
      const r = img.getBoundingClientRect();
      const visible = r.bottom > view.top - view.height && r.top < view.bottom + view.height;
      const need = img.clientWidth * dpr;
      const have = hires.get(i)?.width || result.previewWidth;
      if (visible && need > have * 1.15 && have < 4096) {
        const url = await result.renderPreview(i, need);
        if (!scroller.isConnected) { URL.revokeObjectURL(url); return; }
        const old = hires.get(i);
        hires.set(i, { url, width: Math.min(4096, need) });
        img.src = url;
        if (old) setTimeout(() => URL.revokeObjectURL(old.url), 1000);
      } else if (!visible && hires.has(i)) {
        // 看不到的頁面換回低解析度，節省記憶體
        const old = hires.get(i);
        hires.delete(i);
        img.src = result.previews[i];
        setTimeout(() => URL.revokeObjectURL(old.url), 1000);
      }
    }
  }

  scroller.addEventListener('touchstart', onTouchStart, { passive: false });
  scroller.addEventListener('touchmove', onTouchMove, { passive: false });
  scroller.addEventListener('touchend', onTouchEnd);
  scroller.addEventListener('touchcancel', onTouchEnd);
  scroller.addEventListener('pointerup', onTap);
  scroller.addEventListener('wheel', onWheel, { passive: false });
  scroller.addEventListener('scroll', () => { if (zoom > 1) scheduleHires(); });
  const onResize = () => { applyZoom(); scheduleHires(); };
  window.addEventListener('resize', onResize);

  return {
    zoomTo,
    get zoom() { return zoom; },
    destroy() {
      clearTimeout(hiresTimer);
      window.removeEventListener('resize', onResize);
      hires.forEach(h => URL.revokeObjectURL(h.url));
      hires.clear();
    },
  };
}

// MARK: - 分享／下載檔案

// 在 Claude 的測試網頁裡（內嵌框架）不能分享或下載檔案
const IN_TEST_FRAME = (() => { try { return window.self !== window.top; } catch { return true; } })();

async function shareFile(file) {
  if (IN_TEST_FRAME) {
    await showDialog({
      title: '測試網頁無法存檔',
      message: `這是測試環境的限制，正式上架後就能用 AirDrop、LINE 或「儲存到檔案」。\n（本來要送出的檔案：${file.name}，${Math.max(1, Math.round(file.size / 1024))} KB）`,
      buttons: [{ label: '好', style: 'bold' }],
    });
    return false;
  }
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      console.warn('share 失敗，改用下載', e);
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

function exportFile(projects, kind) {
  const data = buildExportFile(projects, kind);
  return new File([JSON.stringify(data)], fileNameFor(projects, kind), { type: 'application/json' });
}

function fileNameFor(projects, kind) {
  const label = kind === 'handoff' ? '交接' : '備份';
  const name = projects.length === 1 ? safeFileName(projects[0].name) : '全部專案';
  return `聲音報表${label}_${name}_${stamp()}.json`;
}

async function exportAll() {
  if (!state.projects.length) return;
  const ok = await shareFile(exportFile(state.projects, 'backup'));
  if (ok) {
    const now = Date.now();
    state.projects.forEach(p => { p.lastBackupAt = now; });
    persist();
    render();
  }
}

// MARK: - 交接與備份

function fmtTime(ts) {
  if (!ts) return '從未';
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function openHandoff() {
  const p = selectedProject();
  const pending = unbackedCount(p);
  const sheet = openSheet({
    title: '交接與備份',
    right: { label: '完成', bold: true, action: closeSheet },
    body: `<div class="form">
      <div class="section-title">這個專案</div>
      <div class="form-group">
        <div class="kv"><span class="k">專案</span><span class="v">${esc(p.name || '未命名專案')}</span></div>
        <div class="kv"><span class="k">Take 數</span><span class="v">${p.takes.length} 筆</span></div>
        <div class="kv"><span class="k">最後一筆</span><span class="v">${esc(describeLastTake(p))}</span></div>
        <div class="kv"><span class="k">上次匯出</span><span class="v" id="ho-last">${fmtTime(p.lastBackupAt)}${pending ? `（之後新增或修改了 ${pending} 筆）` : ''}</span></div>
      </div>

      <div class="section-title">交接給下一位錄音師</div>
      <div class="notice blue">
        <ol class="steps" style="color:inherit">
          <li>按下方藍色按鈕，選 <b>AirDrop</b> 傳給對方（兩支手機直接傳，<b>不需要網路</b>）。有網路時也可以用 LINE 或 Email。</li>
          <li>對方在 iPhone 上選「<b>儲存到檔案</b>」。</li>
          <li>對方打開聲音報表，在專案列表按「<b>匯入交接檔／備份</b>」，選這個檔案。</li>
        </ol>
        <div style="margin-top:8px">交接檔裡有全部 Take，以及目前拍到的場、鏡、下一個 Take、流水號、軌道設定，對方可以直接接著記。</div>
      </div>
      <button class="primary-btn" id="ho-handoff">${ICON.share}交接給下一位錄音師</button>

      <div class="section-title">備份</div>
      <button class="primary-btn secondary" style="margin-top:0" id="ho-backup">${ICON.archive}存一份備份</button>
      <div class="section-foot">在分享選單中選「儲存到檔案」，就會存一份到 iPhone 的「檔案」App。建議每天收工時存一份。交接檔和備份檔的內容相同，都可以用「匯入」還原。</div>
    </div>`,
  });
  const run = kind => async () => {
    const ok = await shareFile(exportFile([p], kind));
    if (ok) {
      p.lastBackupAt = Date.now();
      persist();
      $('#ho-last', sheet).textContent = fmtTime(p.lastBackupAt);
      toast(kind === 'handoff' ? '交接檔已送出' : '備份檔已送出');
      sheetOnClose = () => render();
    }
  };
  $('#ho-handoff', sheet).addEventListener('click', run('handoff'));
  $('#ho-backup', sheet).addEventListener('click', run('backup'));
}

// MARK: - 匯入

$('#import-input').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = parseImportFile(await file.text());
    if (!data.projects.length) throw new Error('這個檔案裡沒有任何專案。');
    openImport(data, file.name);
  } catch (err) {
    showDialog({ title: '無法匯入', message: err.message || String(err), buttons: [{ label: '好', style: 'bold' }] });
  }
});

function openImport(data, fileName) {
  const items = data.projects.map(incoming => {
    const local = state.projects.find(p => p.id === incoming.id) || null;
    if (!local) return { incoming, local, cmp: null, decision: 'add' };
    const cmp = compareForImport(local, incoming);
    let decision = 'replace';
    if (cmp.identical) decision = 'skip';
    else if (cmp.incomingIsOlder) decision = 'skip';
    else if (cmp.localOnly.length) decision = 'append';
    return { incoming, local, cmp, decision };
  });

  const sheet = openSheet({
    title: '匯入',
    left: { label: '取消', action: closeSheet },
    body: '<div class="form" id="imp"></div>',
  });
  const root = $('#imp', sheet);

  const choice = (i, value, title, desc) =>
    `<button class="choice ${items[i].decision === value ? 'on' : ''}" data-i="${i}" data-v="${value}"><span class="radio"></span><span><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</span></button>`;

  const takeLine = t => `${t.useSerialNumber && t.idNum != null ? `#${t.idNum} ` : ''}${esc(t.date || '未設定日期')}　Take ${esc(t.take)}${t.content ? `　${esc(t.content.slice(0, 18))}` : ''}`;

  function draw() {
    const anything = items.some(it => it.decision !== 'skip');
    root.innerHTML = `
      <div class="section-foot" style="margin-top:14px">檔案：${esc(fileName)}<br>匯出時間：${esc(fmtTime(Date.parse(data.exportedAt)))}</div>
      ${items.map((it, i) => {
        const inc = it.incoming;
        let status = '';
        if (!it.local) {
          status = `<div class="notice blue">這是新專案，會新增到你的專案列表。</div>`;
        } else if (it.cmp.identical) {
          status = `<div class="notice blue">和你手機上的版本完全相同，不需要更新。</div>`;
        } else if (it.cmp.incomingIsOlder) {
          status = `<div class="notice red"><b>⚠︎ 這個檔案比你手機上的版本舊</b>：你手機上多了 ${it.cmp.localOnly.length} 筆 Take，檔案裡沒有新的內容。通常不需要匯入。</div>
            <div class="form-group" style="margin-top:10px">
              ${choice(i, 'skip', '略過，不匯入（建議）')}
              ${choice(i, 'replace', '仍然用這個檔案取代', `手機上多出來的 ${it.cmp.localOnly.length} 筆會被移除（取代前會自動備份）`)}
            </div>`;
        } else if (it.cmp.localOnly.length) {
          const incSerials = new Set(inc.takes.filter(t => t.useSerialNumber && t.idNum != null).map(t => t.idNum));
          const dups = it.cmp.localOnly.filter(t => t.useSerialNumber && t.idNum != null && incSerials.has(t.idNum));
          status = `<div class="notice"><b>你手機上有 ${it.cmp.localOnly.length} 筆 Take 不在這個交接檔裡</b>（可能是交出去之後才補記的）。${dups.length ? `<br>其中 ${dups.length} 筆的流水號和交接檔重複（${dups.slice(0, 3).map(t => `#${t.idNum}`).join('、')}），補進去之後請記得修改。` : ''}</div>
            <div class="form-group" style="margin-top:10px">
              ${choice(i, 'append', `把這 ${it.cmp.localOnly.length} 筆補在最後（建議）`)}
              <div class="mini-list">${it.cmp.localOnly.slice(0, 5).map(takeLine).join('<br>')}${it.cmp.localOnly.length > 5 ? `<br>…還有 ${it.cmp.localOnly.length - 5} 筆` : ''}</div>
              ${choice(i, 'replace', `捨棄這 ${it.cmp.localOnly.length} 筆`, '完全使用交接檔的版本')}
              ${choice(i, 'skip', '不匯入這個專案')}
            </div>`;
        } else {
          status = `<div class="notice blue">會更新成交接檔的版本${it.cmp.incomingOnly.length ? `（多了 ${it.cmp.incomingOnly.length} 筆 Take）` : ''}。</div>`;
        }
        return `
          <div class="section-title">${esc(inc.name || '未命名專案')}</div>
          <div class="form-group">
            <div class="kv"><span class="k">檔案中</span><span class="v">${inc.takes.length} 筆 Take</span></div>
            <div class="kv"><span class="k">檔案最後一筆</span><span class="v">${esc(describeLastTake(inc))}</span></div>
            ${it.local ? `
              <div class="kv"><span class="k">你手機上</span><span class="v">${it.local.takes.length} 筆 Take</span></div>
              <div class="kv"><span class="k">手機最後一筆</span><span class="v">${esc(describeLastTake(it.local))}</span></div>` : ''}
          </div>
          ${status}`;
      }).join('')}
      <button class="primary-btn" id="imp-go" ${anything ? '' : 'disabled'}>${ICON.import}匯入</button>
      <div class="section-foot">匯入前，手機上原本的版本會自動備份，必要時可在「自動備份紀錄」還原。</div>`;

    $$('.choice', root).forEach(b => b.addEventListener('click', () => { items[+b.dataset.i].decision = b.dataset.v; draw(); }));
    $('#imp-go', root).addEventListener('click', apply);
  }
  draw();

  async function apply() {
    const changed = [];
    for (const it of items) {
      if (it.decision === 'skip') continue;
      const inc = normalizeProject(it.incoming);
      inc.lastBackupAt = Date.now();
      if (it.decision === 'add') {
        state.projects.push(inc);
      } else {
        try { await addSnapshot(it.local, '匯入交接檔前'); } catch (e) { console.error(e); }
        if (it.decision === 'append') {
          inc.takes = [...inc.takes, ...it.cmp.localOnly];
          const maxId = Math.max(0, ...inc.takes.map(t => t.idNum ?? 0));
          inc.nextSerialNumber = Math.max(inc.nextSerialNumber, maxId + 1);
        }
        const idx = state.projects.findIndex(p => p.id === inc.id);
        if (idx >= 0) state.projects[idx] = inc; else state.projects.push(inc);
      }
      inc.updatedAt = Date.now();
      changed.push(inc);
    }
    if (!changed.length) return closeSheet();
    state.selectedProjectID = changed[0].id;
    state.view = 'detail';
    state.searchText = '';
    state.editTakes = false;
    persist();
    closeSheet();
    render();
    if (changed.length === 1 && data.kind === 'handoff') {
      openSession({ notice: `<b>已匯入「${esc(changed[0].name)}」。</b><br>接手錄音前，請確認今天的<b>日期、地點</b>，並把<b>錄音師</b>改成你的名字。之後按「[4] 錄製新 Take」就會接著往下記。` });
    } else {
      toast(changed.length === 1 ? `已匯入「${changed[0].name}」` : `已匯入 ${changed.length} 個專案`);
    }
  }
}

// MARK: - 自動備份紀錄

async function openSnapshots() {
  const sheet = openSheet({
    title: '自動備份紀錄',
    right: { label: '完成', bold: true, action: closeSheet },
    body: '<div class="form" id="snaps"><div class="progress">讀取中…</div></div>',
  });
  const root = $('#snaps', sheet);

  async function draw() {
    let snaps = [];
    try { snaps = await listSnapshots(); } catch (e) { console.error(e); }
    root.innerHTML = `
      <div class="section-foot" style="margin-top:14px">匯入交接檔、刪除專案或還原之前，App 會自動在這支手機上備份一份（最多保留 40 份）。要更保險，請定期用「交接與備份」把檔案存到別處。</div>
      ${snaps.length ? `<div class="list-group">${snaps.map(s => `
        <button class="list-row" data-snap="${esc(s.id)}">
          <span class="main"><div class="name" style="font-size:16px">${esc(s.projectName || '未命名專案')} · ${s.takeCount} 筆 Take</div>
          <div class="sub">${fmtTime(s.createdAt)} · ${esc(s.reason)}</div></span><span class="chev">${ICON.chev}</span>
        </button>`).join('')}</div>` : `<div class="empty"><div class="icon">${ICON.clock}</div><p>目前沒有自動備份。</p></div>`}`;
    $$('[data-snap]', root).forEach(b => b.addEventListener('click', () => act(snaps.find(s => s.id === b.dataset.snap))));
  }

  async function act(s) {
    const exists = state.projects.some(p => p.id === s.projectId);
    const i = await showDialog({
      title: `「${s.projectName || '未命名專案'}」${fmtTime(s.createdAt)}`,
      message: exists ? '還原後，這個專案會回到當時的內容。目前的版本會先自動備份。' : '這個專案目前不在列表中，還原後會重新加入。',
      buttons: [{ label: '還原這個備份' }, { label: '匯出成檔案' }, { label: '刪除這個備份', style: 'destructive' }, { label: '取消', style: 'bold' }],
    });
    if (i === 0) {
      const restored = normalizeProject(s.project);
      const idx = state.projects.findIndex(p => p.id === restored.id);
      if (idx >= 0) {
        try { await addSnapshot(state.projects[idx], '還原備份前'); } catch (e) { console.error(e); }
        state.projects[idx] = restored;
      } else state.projects.push(restored);
      restored.updatedAt = Date.now();
      state.selectedProjectID = restored.id;
      persist();
      render();
      toast(`已還原「${restored.name}」`);
      draw();
    } else if (i === 1) {
      await shareFile(exportFile([normalizeProject(s.project)], 'backup'));
    } else if (i === 2) {
      await deleteSnapshot(s.id);
      draw();
    }
  }
  draw();
}

// MARK: - 啟動

async function init() {
  const saved = await loadState();
  state.projects = (saved.projects || []).map(normalizeProject);
  state.selectedProjectID = state.projects.some(p => p.id === saved.selectedProjectID)
    ? saved.selectedProjectID : state.projects[0]?.id || null;
  state.view = state.selectedProjectID ? 'detail' : 'list';
  render();
  requestPersistence();
  registerServiceWorker();
  let wide = window.innerWidth >= 900;
  window.addEventListener('resize', () => {
    const w = window.innerWidth >= 900;
    if (w !== wide) { wide = w; render(); }
  });
}

// 整個畫面禁止雙指縮放與點兩下縮放（PDF 預覽有自己的縮放）
['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', e => { if (e.touches.length > 1 && !e.target.closest?.('.pdf-pages')) e.preventDefault(); }, { passive: false });

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const prompt = worker => toast('有新版本可以使用', { label: '更新', sticky: true, run: () => worker.postMessage('skipWaiting') });
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w);
      });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(e => console.warn('Service worker 註冊失敗', e));
  // 只有「更新版本」時才重新載入；第一次安裝不需要
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return; reloaded = true;
    flush();
    location.reload();
  });
}

init();
