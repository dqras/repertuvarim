/**
 * Veri erişimi: ekranlar şarkılara ve kategorilere yalnızca bu dosya üzerinden ulaşır.
 * Veriler cihazdaki veritabanında (IndexedDB) saklanır; ayrıntılar db.js'de.
 */
import { openDatabase, transact, result, StorageError } from './db.js';
import { normalizeSong, normalizeCategory, createId } from './model.js';
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

/**
 * Yeni şarkı kaydeder. fields: model.js validateSongForm'un "value" çıktısı.
 * Kaydedilen şarkıyı döndürür.
 */
export async function createSong(fields) {
  const now = Date.now();
  const song = normalizeSong({ ...fields, id: createId(), isSample: false, createdAt: now, updatedAt: now });
  await transact(await init(), ['songs', 'drafts'], 'readwrite', async ({ songs, drafts }) => {
    await result(songs.add(song));
    drafts.delete('new');
  });
  notifyChange();
  return song;
}

/**
 * Kayıtlı şarkıyı günceller; eklenme zamanı korunur.
 * Düzenlenen örnek şarkı artık kullanıcının şarkısı sayılır ("Örnekleri kaldır" onu silmez).
 */
export async function updateSong(id, fields) {
  const song = await transact(await init(), ['songs', 'drafts'], 'readwrite', async ({ songs, drafts }) => {
    const row = await result(songs.get(id));
    if (!row) throw new StorageError('notFound');
    const updated = normalizeSong({ ...row, ...fields, id, isSample: false, createdAt: row.createdAt, updatedAt: Date.now() });
    await result(songs.put(updated));
    drafts.delete(id);
    return updated;
  });
  notifyChange();
  return song;
}

/** Şarkıyı (ve varsa taslağını) siler. */
export async function deleteSong(id) {
  await transact(await init(), ['songs', 'drafts', 'settings'], 'readwrite', ({ songs, drafts, settings }) => {
    songs.delete(id);
    drafts.delete(id);
    settings.delete(`transpose:${id}`);
  });
  notifyChange();
}

// --- Ayarlar: yazı boyutu, şarkı başına transpoze, ekranı açık tutma ------------

/** Bir ayarı okur; kayıtlı değilse fallback döner. */
export async function getSetting(key, fallback = null) {
  const row = await transact(await init(), 'settings', 'readonly', ({ settings }) => result(settings.get(key)));
  return row ? row.value : fallback;
}

/** Bir ayarı kaydeder. value null ise ayar silinir. */
export async function setSetting(key, value) {
  await transact(await init(), 'settings', 'readwrite', ({ settings }) =>
    result(value === null ? settings.delete(key) : settings.put({ key, value }))
  );
}

// --- Taslaklar: kaydedilmemiş form içerikleri --------------------------------
// key: yeni şarkı için "new", düzenlenen şarkı için şarkının id'si.

export async function getDraft(key) {
  return (await transact(await init(), 'drafts', 'readonly', ({ drafts }) => result(drafts.get(key)))) ?? null;
}

export async function saveDraft(key, form) {
  const draft = { key, form, updatedAt: Date.now() };
  await transact(await init(), 'drafts', 'readwrite', ({ drafts }) => result(drafts.put(draft)));
  return draft;
}

export async function deleteDraft(key) {
  await transact(await init(), 'drafts', 'readwrite', ({ drafts }) => result(drafts.delete(key)));
}

export async function listDrafts() {
  return transact(await init(), 'drafts', 'readonly', ({ drafts }) => result(drafts.getAll()));
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
