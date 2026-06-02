// IndexedDB 封装:存项目元数据、视频 Blob、文件夹句柄、字帖库
const DB_NAME = 'jiangge_db';
const DB_VERSION = 2;   // v2: 加 copybooks(字帖库)store

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        const s = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('handles')) {
        db.createObjectStore('handles', { keyPath: 'key' });
      }
      // 字帖库:整个 PDF 文件 Blob + 缩略图 dataURL + 名字 + 使用时间
      if (!db.objectStoreNames.contains('copybooks')) {
        const s = db.createObjectStore('copybooks', { keyPath: 'id', autoIncrement: true });
        s.createIndex('lastUsedAt', 'lastUsedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}

// ========= 项目 =========
export async function saveProject(project) {
  const store = await tx('projects', 'readwrite');
  project.updatedAt = Date.now();
  if (!project.createdAt) project.createdAt = Date.now();
  return new Promise((resolve, reject) => {
    const r = project.id ? store.put(project) : store.add(project);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function listProjects() {
  const store = await tx('projects');
  return new Promise((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result.sort((a,b)=>b.createdAt-a.createdAt));
    r.onerror = () => reject(r.error);
  });
}

export async function getProject(id) {
  const store = await tx('projects');
  return new Promise((resolve, reject) => {
    const r = store.get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function deleteProject(id) {
  const store = await tx('projects', 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// ========= Blob (视频、音频) =========
export async function putBlob(id, blob) {
  const store = await tx('blobs', 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.put({ id, blob });
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function getBlob(id) {
  const store = await tx('blobs');
  return new Promise((resolve, reject) => {
    const r = store.get(id);
    r.onsuccess = () => resolve(r.result ? r.result.blob : null);
    r.onerror = () => reject(r.error);
  });
}

// ========= 文件夹句柄(File System Access API) =========
export async function saveDirHandle(handle) {
  const store = await tx('handles', 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.put({ key: 'output_dir', handle });
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function loadDirHandle() {
  const store = await tx('handles');
  return new Promise((resolve, reject) => {
    const r = store.get('output_dir');
    r.onsuccess = () => resolve(r.result ? r.result.handle : null);
    r.onerror = () => reject(r.error);
  });
}

export async function pickAndSaveDir() {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('当前浏览器不支持选择本地文件夹,请使用 Chrome / Edge');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await saveDirHandle(handle);
  return handle;
}

// ========= 字帖库(copybooks) =========
export async function saveCopybook({ name, fileBlob, thumbnailDataUrl }) {
  const store = await tx('copybooks', 'readwrite');
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const r = store.add({
      name: name || '未命名字帖',
      fileBlob,
      thumbnailDataUrl: thumbnailDataUrl || '',
      addedAt: now,
      lastUsedAt: now,
    });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function listCopybooks() {
  const store = await tx('copybooks');
  return new Promise((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0)));
    r.onerror = () => reject(r.error);
  });
}

export async function getCopybook(id) {
  const store = await tx('copybooks');
  return new Promise((resolve, reject) => {
    const r = store.get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function deleteCopybook(id) {
  const store = await tx('copybooks', 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function touchCopybook(id) {
  const cb = await getCopybook(id);
  if (!cb) return;
  cb.lastUsedAt = Date.now();
  const store = await tx('copybooks', 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.put(cb);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function renameCopybook(id, name) {
  const cb = await getCopybook(id);
  if (!cb) return;
  cb.name = name;
  const store = await tx('copybooks', 'readwrite');
  return new Promise((resolve, reject) => {
    const r = store.put(cb);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function writeFileToDir(filename, blob) {
  const handle = await loadDirHandle();
  if (!handle) throw new Error('未设置保存文件夹');
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    const req = await handle.requestPermission({ mode: 'readwrite' });
    if (req !== 'granted') throw new Error('未获得文件夹写入权限');
  }
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return filename;
}
