/**
 * Cihazdaki veritabanı (IndexedDB).
 * Şarkılar, kategoriler ve ayarlar burada saklanır. İnternet gerekmez; uygulama
 * kapanıp açılınca da veriler yerinde kalır. Diğer dosyalar veritabanına
 * doğrudan değil, repository.js üzerinden ulaşır.
 */

const DB_NAME = 'repertuvarim';

/**
 * Veritabanı yükseltme adımları. Yeni bir sürüm yeni bir depo gerektirdiğinde
 * listenin SONUNA bir adım eklenir; eski adımlar asla değiştirilmez.
 * Böylece eski sürümü kullananların verileri korunarak yükseltilir.
 */
const UPGRADES = [
  // Sürüm 1: şarkılar, kategoriler ve ayarlar
  (db) => {
    db.createObjectStore('songs', { keyPath: 'id' });
    db.createObjectStore('categories', { keyPath: 'id' });
    db.createObjectStore('settings', { keyPath: 'key' });
  },
  // Sürüm 2: kaydedilmemiş şarkı taslakları (yeni şarkı için "new", düzenleme için şarkının id'si)
  (db) => {
    db.createObjectStore('drafts', { keyPath: 'key' });
  },
];
const DB_VERSION = UPGRADES.length;

/** Veritabanı hatası; reason kullanıcıya gösterilecek mesajı belirler. */
export class StorageError extends Error {
  /** reason: 'unsupported' | 'open' | 'quota' | 'write' | 'notFound' */
  constructor(reason, cause) {
    super(cause?.message ? `${reason}: ${cause.message}` : reason);
    this.name = 'StorageError';
    this.reason = reason;
    this.cause = cause;
  }
}

/** Hatanın kullanıcıya gösterilecek Türkçe açıklaması. */
export function describeStorageError(error) {
  switch (error?.reason) {
    case 'unsupported':
      return 'Bu tarayıcı cihaza veri kaydetmeye izin vermiyor. Gizli (özel) pencere kullanıyorsanız uygulamayı normal pencerede açın.';
    case 'quota':
      return 'Cihazda yer kalmadığı için kayıt yapılamadı. Biraz yer açıp tekrar deneyin.';
    case 'notFound':
      return 'Bu şarkı artık kayıtlı değil.';
    case 'write':
      return 'Değişiklik kaydedilemedi. Tekrar deneyin.';
    default:
      return 'Kayıtlı veriler açılamadı. Uygulamayı kapatıp yeniden açın.';
  }
}

function reasonFor(error) {
  if (error?.name === 'QuotaExceededError') return 'quota';
  // Bazı tarayıcılar gizli pencerede veritabanını bu hatalarla reddeder.
  if (['InvalidStateError', 'SecurityError', 'NotAllowedError'].includes(error?.name)) return 'unsupported';
  return 'open';
}

/**
 * Veritabanını açar.
 * onCreate(transaction): veritabanı ilk kez oluşturulurken ilk verileri yazmak için.
 * onBlocked(): yükseltme, başka bir pencerede açık olan eski sürümü bekliyorsa.
 * onVersionChange(): başka bir pencerede daha yeni bir sürüm açıldıysa.
 */
export function openDatabase({ onCreate, onBlocked, onVersionChange } = {}) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      if (!globalThis.indexedDB) throw new Error('IndexedDB bulunamadı');
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(new StorageError('unsupported', error));
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (let version = event.oldVersion; version < DB_VERSION; version += 1) {
        UPGRADES[version](db, request.transaction);
      }
      if (event.oldVersion === 0) onCreate?.(request.transaction);
    };
    request.onblocked = () => onBlocked?.();
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        onVersionChange?.();
      };
      resolve(db);
    };
    request.onerror = () => reject(new StorageError(reasonFor(request.error), request.error));
  });
}

/** Tek bir veritabanı isteğinin sonucunu bekler. */
export function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Bir işlem (transaction) içinde çalışır; işlem tamamen kaydedilince sonuçlanır.
 * work({ depoAdı: depo }) içinde yalnızca veritabanı istekleri beklenmelidir.
 * Bir adım başarısız olursa işlemin hiçbir parçası kaydedilmez.
 */
export function transact(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (error) {
      reject(new StorageError('open', error));
      return;
    }
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const stores = Object.fromEntries(names.map((name) => [name, tx.objectStore(name)]));
    let value;
    let failure = null;

    Promise.resolve()
      .then(() => work(stores))
      .then(
        (workResult) => {
          value = workResult;
        },
        (error) => {
          failure = error;
          try {
            tx.abort();
          } catch {
            // İşlem zaten bitmişse yapılacak bir şey yok.
          }
        }
      );

    tx.oncomplete = () => resolve(value);
    tx.onabort = () => {
      if (failure instanceof StorageError) reject(failure);
      else if (tx.error?.name === 'QuotaExceededError') reject(new StorageError('quota', tx.error));
      else reject(new StorageError('write', failure ?? tx.error));
    };
  });
}

/**
 * Tarayıcıdan, yer darlığında bile verilerin kendiliğinden silinmemesini ister.
 * Sonuç: 'granted' (izin verildi) | 'denied' (verilmedi) | 'unsupported' (desteklenmiyor)
 */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return 'unsupported';
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/** Kullanılan ve tarayıcının izin verdiği en fazla alan (bayt). Bilinmiyorsa null. */
export async function estimateStorage() {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}
