// 手機本機儲存（IndexedDB）。所有資料只存在這支手機上，不需要網路。

const DB_NAME = 'soundReport';
const DB_VERSION = 1;
const MAX_SNAPSHOTS = 40;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function loadState() {
  try {
    return await tx('kv', 'readonly', s => {
      const a = reqP(s.get('projects')), b = reqP(s.get('selectedProjectID'));
      return Promise.all([a, b]).then(([projects, selectedProjectID]) => ({
        projects: projects || [], selectedProjectID: selectedProjectID || null,
      }));
    });
  } catch (e) {
    console.error(e);
    // IndexedDB 不能用時的備援
    try {
      return JSON.parse(localStorage.getItem('soundReport.state') || 'null') || { projects: [], selectedProjectID: null };
    } catch { return { projects: [], selectedProjectID: null }; }
  }
}

export async function saveState(projects, selectedProjectID) {
  try {
    await tx('kv', 'readwrite', s => {
      s.put(projects, 'projects');
      s.put(selectedProjectID, 'selectedProjectID');
    });
  } catch (e) {
    console.error(e);
    try { localStorage.setItem('soundReport.state', JSON.stringify({ projects, selectedProjectID })); } catch {}
  }
}

/** 自動備份：匯入覆蓋、刪除專案、還原之前，先存一份 */
export async function addSnapshot(project, reason) {
  const snap = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(), reason,
    projectId: project.id, projectName: project.name, takeCount: project.takes.length,
    project: JSON.parse(JSON.stringify(project)),
  };
  await tx('snapshots', 'readwrite', s => s.put(snap));
  const all = await listSnapshots();
  if (all.length > MAX_SNAPSHOTS) {
    const extra = all.slice(MAX_SNAPSHOTS);
    await tx('snapshots', 'readwrite', s => extra.forEach(x => s.delete(x.id)));
  }
  return snap;
}

export async function listSnapshots() {
  const all = await tx('snapshots', 'readonly', s => reqP(s.getAll()));
  return (all || []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteSnapshot(id) {
  await tx('snapshots', 'readwrite', s => s.delete(id));
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {}
}
