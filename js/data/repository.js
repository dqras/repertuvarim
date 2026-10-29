/**
 * Veri erişimi: ekranlar şarkılara ve kategorilere yalnızca bu dosya üzerinden ulaşır.
 * Veriler cihazdaki veritabanında (IndexedDB) saklanır; ayrıntılar db.js'de.
 */
import { openDatabase, transact, result, StorageError } from './db.js';
import { normalizeSong, normalizeCategory } from './model.js';
import { DEFAULT_CATEGORIES } from './defaults.js';
import { SAMPLE_SONGS } from './sample-songs.js';

let ready = null;
const listeners = new Set();

/**
 * Veritabanını açar. İlk açılışta hazır kategorileri ve örnek şarkıları bir kez yazar;
 * sonraki açılışlarda kayıtlı verilere dokunmaz.
 * events.onBlocked / events.onVersionChange: bkz. db.js openDatabase.
 */
export function init(events = {}) {
  ready ??= openDatabase({
    onCreate(transaction) {
      const now = Date.now();
      const categories = transaction.objectStore('categories');
      DEFAULT_CATEGORIES.forEach((category, order) => {
        categories.add(normalizeCategory({ ...category, order, createdAt: now }, order));
      });
      const songs = transaction.objectStore('songs');
      for (const song of SAMPLE_SONGS) songs.add(normalizeSong({ ...song, isSample: true }));
    },
    onBlocked: events.onBlocked,
    onVersionChange: events.onVersionChange,
  });
  return ready;
}

/** Kayıtlı veriler değişince haber verir (ör. favori değişti). Aboneliği bitiren fonksiyonu döndürür. */
export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyChange() {
  for (const listener of listeners) listener();
}

export async function listSongs() {
  const rows = await transact(await init(), 'songs', 'readonly', ({ songs }) => result(songs.getAll()));
  return rows.map(normalizeSong);
}

export async function getSong(id) {
  const row = await transact(await init(), 'songs', 'readonly', ({ songs }) => result(songs.get(id)));
  return row ? normalizeSong(row) : null;
}

export async function countSongs() {
  return transact(await init(), 'songs', 'readonly', ({ songs }) => result(songs.count()));
}

export async function listCategories() {
  const rows = await transact(await init(), 'categories', 'readonly', ({ categories }) => result(categories.getAll()));
  return rows.map((row, index) => normalizeCategory(row, index)).sort((a, b) => a.order - b.order);
}

/** Şarkıyı favorilere ekler ya da çıkarır; güncel şarkıyı döndürür. */
export async function setFavorite(id, favorite) {
  const song = await transact(await init(), 'songs', 'readwrite', async ({ songs }) => {
    const row = await result(songs.get(id));
    if (!row) throw new StorageError('notFound');
    const updated = { ...row, favorite: Boolean(favorite) };
    await result(songs.put(updated));
    return normalizeSong(updated);
  });
  notifyChange();
  return song;
}

/** Örnek şarkıların hepsini siler; kaç şarkı silindiğini döndürür. Kullanıcının şarkılarına dokunmaz. */
export async function removeSampleSongs() {
  const removed = await transact(await init(), 'songs', 'readwrite', async ({ songs }) => {
    const rows = await result(songs.getAll());
    const samples = rows.filter((row) => row.isSample === true);
    for (const row of samples) songs.delete(row.id);
    return samples.length;
  });
  notifyChange();
  return removed;
}
