// 프리셋 캐시 (IndexedDB) — 운영자가 로드한 .frame.preset 파일을 원본 zip Blob
// 그대로 저장한다. 페이지 새로고침 후에도 visitor 가 같은 프레임을 고를 수 있게
// 하는 게 목적.
//
// 키: id (preset.meta.id 또는 crypto.randomUUID())
// 값: StoredPreset

export type StoredPreset = {
  id: string;
  name: string;
  presetZip: Blob;
  thumbnail: Blob | null;
  addedAt: number;
  order: number;
};

const DB_NAME = 'photo-kiosk';
const DB_VERSION = 1;
const STORE = 'presets';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open 실패'));
  });
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request 실패'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await open();
  const tx = db.transaction(STORE, mode);
  const result = await fn(tx.objectStore(STORE));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx 실패'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx abort'));
  });
  return result;
}

export async function listPresets(): Promise<StoredPreset[]> {
  const all = await withStore('readonly', (store) =>
    reqAsPromise(store.getAll() as IDBRequest<StoredPreset[]>),
  );
  return all.sort((a, b) => a.order - b.order);
}

export async function putPreset(p: StoredPreset): Promise<void> {
  await withStore('readwrite', (store) => reqAsPromise(store.put(p)));
}

export async function deletePreset(id: string): Promise<void> {
  await withStore('readwrite', (store) => reqAsPromise(store.delete(id)));
}

export async function clearPresets(): Promise<void> {
  await withStore('readwrite', (store) => reqAsPromise(store.clear()));
}
