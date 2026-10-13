// 聲音報表 — 資料模型與核心邏輯（由 Models.swift 移植）

export const APP_VERSION = '1.3.3';
export const TRACK_COUNT = 8;

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID().toUpperCase();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`.toUpperCase();
}

export function todayString() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const defaultTracks = () => Array.from({ length: TRACK_COUNT }, () => ({ name: '', isActive: false }));
export const cloneTracks = tracks => normalizeTracks(tracks).map(t => ({ name: t.name, isActive: t.isActive }));

function normalizeTracks(tracks) {
  const out = defaultTracks();
  (Array.isArray(tracks) ? tracks : []).slice(0, TRACK_COUNT).forEach((t, i) => {
    out[i] = { name: String(t?.name ?? ''), isActive: !!t?.isActive };
  });
  return out;
}

export function newTake() {
  return {
    id: uuid(), useSerialNumber: true, idNum: null,
    scene: '', shot: '', take: '', size: '',
    tracks: defaultTracks(), content: '', note: '',
    date: '', location: '', sdFolder: '', mixer: '', boom: '',
    modifiedAt: Date.now(),
  };
}

export function newProject(name) {
  const now = Date.now();
  return {
    id: uuid(), name,
    info: { title: '', director: '', producer: '', mixer: '', boom: '' },
    sessionDefaults: { date: todayString(), location: '', sdFolder: '', mixer: '', boom: '' },
    takes: [], nextSerialNumber: 1, useSerialNumber: true,
    currentScene: '', currentShot: '', currentSize: '',
    currentTracks: defaultTracks(), currentTakeNumber: 1, isNewShot: true,
    createdAt: now, updatedAt: now, lastBackupAt: null,
  };
}

const str = v => (v == null ? '' : String(v));

/** 讓任何來源（舊版、交接檔）的資料都補齊欄位，避免缺欄位造成錯誤 */
export function normalizeProject(p) {
  const base = newProject(str(p?.name));
  const info = { ...base.info, ...(p?.info || {}) };
  const sd = { ...base.sessionDefaults, ...(p?.sessionDefaults || {}) };
  if (!p?.sessionDefaults || p.sessionDefaults.mixer == null) sd.mixer = str(info.mixer);
  if (!p?.sessionDefaults || p.sessionDefaults.boom == null) sd.boom = str(info.boom);
  const proj = {
    ...base, ...p,
    id: str(p?.id) || base.id,
    info: Object.fromEntries(Object.entries(info).map(([k, v]) => [k, str(v)])),
    sessionDefaults: Object.fromEntries(Object.entries(sd).map(([k, v]) => [k, str(v)])),
    currentTracks: normalizeTracks(p?.currentTracks),
    takes: (Array.isArray(p?.takes) ? p.takes : []).map(t => normalizeTake(t, info.mixer, info.boom)),
  };
  proj.nextSerialNumber = Number.isFinite(+proj.nextSerialNumber) ? +proj.nextSerialNumber : 1;
  proj.currentTakeNumber = Number.isFinite(+proj.currentTakeNumber) ? +proj.currentTakeNumber : 1;
  proj.useSerialNumber = proj.useSerialNumber !== false;
  proj.isNewShot = !!proj.isNewShot;
  for (const k of ['name', 'currentScene', 'currentShot', 'currentSize']) proj[k] = str(proj[k]);
  return proj;
}

function normalizeTake(t, fallbackMixer = '', fallbackBoom = '') {
  const base = newTake();
  const r = { ...base, ...t };
  for (const k of ['id', 'scene', 'shot', 'take', 'size', 'content', 'note', 'date', 'location', 'sdFolder', 'mixer', 'boom']) r[k] = str(r[k]);
  if (t?.mixer == null) r.mixer = str(fallbackMixer);
  if (t?.boom == null) r.boom = str(fallbackBoom);
  r.id = r.id || base.id;
  r.useSerialNumber = r.useSerialNumber !== false;
  r.idNum = r.idNum === null || r.idNum === undefined || r.idNum === '' || !Number.isFinite(+r.idNum) ? null : +r.idNum;
  r.tracks = normalizeTracks(r.tracks);
  r.modifiedAt = +r.modifiedAt || 0;
  return r;
}

export const isFirstTakeOfShot = record => record.scene !== '';

// MARK: - Take 有效上下文（場/鏡繼承）

export function effectiveContext(records, index) {
  let scene = '', shot = '', size = '', tracks = defaultTracks();
  for (let i = 0; i <= index; i++) {
    const r = records[i];
    if (r.scene !== '') { scene = r.scene; shot = r.shot; }
    if (r.size !== '') size = r.size;
    tracks = r.tracks;
  }
  return { scene, shot, size, tracks };
}

/** 一次算完所有 Take 的有效上下文（列表與搜尋用，避免 O(n²)） */
export function allContexts(records) {
  const out = [];
  let scene = '', shot = '', size = '';
  for (const r of records) {
    if (r.scene !== '') { scene = r.scene; shot = r.shot; }
    if (r.size !== '') size = r.size;
    out.push({ scene, shot, size, tracks: r.tracks });
  }
  return out;
}

// MARK: - PDF 軌道顯示

/**
 * PDF 報表專用：同鏡續拍留白，新鏡第一拍顯示實際軌道名稱。
 * 修正：原版因為先判斷「未啟用一律留白」，「上一拍有開、這一拍關掉 → x」永遠不會出現。
 */
export function pdfDisplayTrackName(record, trackIndex, records, recordIndex, isFirstRowOfPage = false, startsNewSetup = isFirstTakeOfShot(record)) {
  if (trackIndex >= record.tracks.length) return '';
  const cur = record.tracks[trackIndex];

  // 換鏡第一拍／整份第一筆／新一頁第一行：完整印出有開啟的軌道名稱
  if (startsNewSetup || recordIndex === 0 || isFirstRowOfPage) {
    return cur.isActive ? cur.name : '';
  }

  const prev = records[recordIndex - 1]?.tracks?.[trackIndex];
  const prevActive = prev?.isActive ?? false;
  const prevName = prev?.name ?? '';

  if (!cur.isActive) {
    // 上一拍有開，這一拍關掉 → x；原本就沒開 → 留白
    return prevActive ? 'x' : '';
  }
  // 同頁續拍且軌道狀態與上一拍完全相同 → 留白
  if (prevActive && prevName === cur.name) return '';
  // 臨時加開或修改名稱 → 印出新名稱
  return cur.name;
}

// MARK: - 搜尋（與原版規則相同）

export function filterTakes(takes, searchText) {
  const rawQuery = searchText.trim();
  if (!rawQuery) return takes;
  const lowerQuery = rawQuery.toLowerCase();
  const tokens = lowerQuery.replace(/[-/.]/g, ' ').split(' ').filter(Boolean);
  const ctxs = allContexts(takes);

  return takes.filter((take, index) => {
    const ctx = ctxs[index];
    const sceneStr = ctx.scene.toLowerCase();
    const shotStr = ctx.shot.toLowerCase();
    const takeStr = take.take.toLowerCase();

    if (tokens.length === 2) return sceneStr === tokens[0] && shotStr === tokens[1];
    if (tokens.length >= 3) return sceneStr === tokens[0] && shotStr === tokens[1] && takeStr === tokens[2];

    if (take.idNum != null) {
      if (`#${take.idNum}` === lowerQuery || `${take.idNum}` === rawQuery) return true;
    }
    if (tokens.length === 1) {
      if (sceneStr === tokens[0]) return true;
      if (take.content.toLowerCase().includes(tokens[0])) return true;
    }
    return false;
  });
}

// MARK: - 列表分組（日期＋地點＋錄音師）

export const groupKey = t => `${t.date}\u0000${t.location}\u0000${t.mixer}`;

export function groupTakes(takes) {
  const groups = [];
  for (const take of takes) {
    const last = groups[groups.length - 1];
    if (last && groupKey(last) === groupKey(take)) last.takes.push(take);
    else groups.push({ date: take.date, location: take.location, mixer: take.mixer, takes: [take] });
  }
  return groups;
}

// MARK: - PDF 分頁（日期、地點、錄音師改變或滿 25 行就換頁）

export const ROWS_PER_PAGE = 25;

export function paginate(records) {
  const pages = [];
  let bucket = [], start = 0;
  const flush = () => {
    if (!bucket.length) return;
    const h = bucket[0];
    pages.push({ pageNumber: pages.length + 1, date: h.date, location: h.location, sdFolder: h.sdFolder, mixer: h.mixer, boom: '', globalStartIndex: start, records: bucket });
    bucket = [];
  };
  records.forEach((r, i) => {
    if (bucket.length) {
      const h = bucket[0];
      if (bucket.length >= ROWS_PER_PAGE || r.date !== h.date || r.location !== h.location || r.mixer !== h.mixer) flush();
    }
    if (!bucket.length) start = i;
    bucket.push(r);
  });
  flush();

  // 收音助理跟著錄音師：同一位錄音師「連續」負責的那幾頁，合併顯示這段期間所有的收音助理
  for (let i = 0; i < pages.length;) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1].mixer === pages[i].mixer) j++;
    const names = [];
    for (let k = i; k <= j; k++) for (const r of pages[k].records) for (const n of splitNames(r.boom)) if (!names.includes(n)) names.push(n);
    for (let k = i; k <= j; k++) pages[k].boom = names.join('、');
    i = j + 1;
  }
  return pages;
}

/** 把「X、Y」「X,Y」「X / Y」等寫法拆成名字清單 */
export function splitNames(s) {
  return String(s || '').split(/[、,，;；\/／\s]+/).map(x => x.trim()).filter(Boolean);
}

/**
 * 這一筆是否換了鏡位：直接和前一筆比對場、鏡。
 * 不管中間怎麼重設 [3] 或拖曳排序，場鏡和前一筆相同就視為同鏡續拍。
 */
export function startsNewSetup(contexts, index) {
  if (index === 0) return true;
  const a = contexts[index], b = contexts[index - 1];
  return a.scene !== b.scene || a.shot !== b.shot;
}

/** Size 是否和前一筆不同（拍攝中臨時改 Size） */
export function sizeChanged(contexts, index) {
  return index === 0 || contexts[index].size !== contexts[index - 1].size;
}

/** 這個場鏡之前拍到第幾次，回傳下一個 Take 次數；沒拍過回傳 null */
export function nextTakeNumberFor(takes, scene, shot) {
  if (!scene && !shot) return null;
  const ctxs = allContexts(takes);
  let max = null;
  takes.forEach((t, i) => {
    if (ctxs[i].scene !== scene || ctxs[i].shot !== shot) return;
    const n = /^\d+$/.test(t.take.trim()) ? parseInt(t.take.trim(), 10) : null;
    if (n != null && (max == null || n > max)) max = n;
  });
  return max == null ? null : max + 1;
}

/** 單一資料列在 PDF 上的 15 個欄位文字 */
export function pdfRowCells(record, globalIndex, allRecords, isFirstRowOfPage, contexts) {
  const serial = record.useSerialNumber && record.idNum != null ? String(record.idNum) : '';
  const ctx = contexts[globalIndex];
  const newSetup = startsNewSetup(contexts, globalIndex);
  // 換場鏡或新一頁第一行：印出場、鏡；場鏡和前一筆相同就留白
  const show = newSetup || isFirstRowOfPage;
  // Size 獨立判斷：換場鏡時一定印，同鏡中途改 Size 也會印
  const showSize = show || sizeChanged(contexts, globalIndex);
  const cells = [serial, show ? ctx.scene : '', show ? ctx.shot : '', record.take, showSize ? ctx.size : ''];
  for (let t = 0; t < TRACK_COUNT; t++) cells.push(pdfDisplayTrackName(record, t, allRecords, globalIndex, isFirstRowOfPage, newSetup));
  cells.push(record.content, record.note);
  return cells;
}

// MARK: - 交接檔／備份檔

export const FILE_FORMAT = 'SoundReport';
export const FILE_VERSION = 1;

export function buildExportFile(projects, kind) {
  return {
    format: FILE_FORMAT, version: FILE_VERSION, kind,
    exportedAt: new Date().toISOString(),
    projects: projects.map(p => JSON.parse(JSON.stringify(p))),
  };
}

export function parseImportFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('這不是聲音報表的交接檔或備份檔（無法讀取內容）。'); }
  if (data?.format !== FILE_FORMAT || !Array.isArray(data.projects)) {
    throw new Error('這不是聲音報表的交接檔或備份檔。');
  }
  if ((data.version ?? 1) > FILE_VERSION) throw new Error('這個檔案來自較新版本的 App，請先更新 App 再匯入。');
  return { ...data, projects: data.projects.map(normalizeProject) };
}

/** 比較手機上的版本與匯入的版本 */
export function compareForImport(local, incoming) {
  const incomingIds = new Set(incoming.takes.map(t => t.id));
  const localIds = new Set(local.takes.map(t => t.id));
  const localOnly = local.takes.filter(t => !incomingIds.has(t.id));
  const incomingOnly = incoming.takes.filter(t => !localIds.has(t.id));
  const incomingIsOlder = incomingOnly.length === 0 && localOnly.length > 0;
  const identical = localOnly.length === 0 && incomingOnly.length === 0 &&
    JSON.stringify(stripMeta(local)) === JSON.stringify(stripMeta(incoming));
  return { localOnly, incomingOnly, incomingIsOlder, identical };
}

function stripMeta(p) {
  const { updatedAt, lastBackupAt, createdAt, ...rest } = p;
  return rest;
}

export function describeLastTake(project) {
  const takes = project.takes;
  if (!takes.length) return '尚無 Take';
  const i = takes.length - 1, t = takes[i];
  const ctx = effectiveContext(takes, i);
  const serial = t.useSerialNumber && t.idNum != null ? `#${t.idNum} ` : '';
  return `${serial}${t.date || '未設定日期'}　場 ${ctx.scene} / 鏡 ${ctx.shot} / 次 ${t.take}`;
}

export function safeFileName(s) {
  return (s || '未命名專案').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
}

export function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
