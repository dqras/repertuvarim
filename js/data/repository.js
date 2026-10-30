/**
 * Veri erişimi: ekranlar şarkılara ve kategorilere yalnızca bu dosya üzerinden ulaşır.
 * Veriler cihazdaki veritabanında (IndexedDB) saklanır; ayrıntılar db.js'de.
 */
import { openDatabase, transact, result, StorageError } from './db.js';
import { normalizeSong, normalizeCategory, normalizeSetlist, createId, validateName, CATEGORY_COLORS } from './model.js';
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

/** Şarkıyı (ve varsa taslağını) siler; bulunduğu setlistlerden de çıkarır. */
export async function deleteSong(id) {
  await transact(await init(), ['songs', 'drafts', 'settings', 'setlists'], 'readwrite', async ({ songs, drafts, settings, setlists }) => {
    songs.delete(id);
    drafts.delete(id);
    settings.delete(`transpose:${id}`);
    for (const row of await result(setlists.getAll())) {
      if (row.songIds?.includes(id)) setlists.put({ ...row, songIds: row.songIds.filter((songId) => songId !== id), updatedAt: Date.now() });
    }
  });
  notifyChange();
}

// --- Kategoriler: ekleme, ad/renk değiştirme, sıralama, silme -------------------

/** Yeni kategori ekler. Ad boşsa ya da aynı adda kategori varsa StorageError('invalid'). */
export async function createCategory({ name, color }) {
  const category = await transact(await init(), 'categories', 'readwrite', async ({ categories }) => {
    const rows = await result(categories.getAll());
    const check = validateName(name, rows, { label: 'Kategori adı' });
    if (!check.ok) throw Object.assign(new StorageError('invalid'), { detail: check.error });
    const order = rows.reduce((max, row) => Math.max(max, row.order ?? 0), -1) + 1;
    const created = normalizeCategory({
      id: createId(),
      name: check.name,
      color: CATEGORY_COLORS.includes(color) ? color : CATEGORY_COLORS[rows.length % CATEGORY_COLORS.length],
      order,
      createdAt: Date.now(),
    }, order);
    await result(categories.add(created));
    return created;
  });
  notifyChange();
  return category;
}

/** Kategorinin adını ve/veya rengini değiştirir. */
export async function updateCategory(id, { name, color }) {
  const category = await transact(await init(), 'categories', 'readwrite', async ({ categories }) => {
    const rows = await result(categories.getAll());
    const row = rows.find((item) => item.id === id);
    if (!row) throw new StorageError('notFound');
    const updated = { ...row };
    if (name !== undefined) {
      const check = validateName(name, rows.filter((item) => item.id !== id), { label: 'Kategori adı' });
      if (!check.ok) throw Object.assign(new StorageError('invalid'), { detail: check.error });
      updated.name = check.name;
    }
    if (color !== undefined && CATEGORY_COLORS.includes(color)) updated.color = color;
    await result(categories.put(updated));
    return normalizeCategory(updated);
  });
  notifyChange();
  return category;
}

/** Kategorileri verilen sıraya koyar (ids: bütün kategori kimlikleri, yeni sırasıyla). */
export async function reorderCategories(ids) {
  await transact(await init(), 'categories', 'readwrite', async ({ categories }) => {
    const rows = await result(categories.getAll());
    const position = new Map(ids.map((id, index) => [id, index]));
    for (const row of rows) {
      const order = position.has(row.id) ? position.get(row.id) : ids.length + (row.order ?? 0);
      if (order !== row.order) categories.put({ ...row, order });
    }
  });
  notifyChange();
}

/** Kategoriyi siler. Şarkılar silinmez; yalnızca bu kategoriden çıkarılır. Kaç şarkının etkilendiğini döndürür. */
export async function deleteCategory(id) {
  const changed = await transact(await init(), ['categories', 'songs'], 'readwrite', async ({ categories, songs }) => {
    categories.delete(id);
    let count = 0;
    for (const row of await result(songs.getAll())) {
      if (Array.isArray(row.categoryIds) && row.categoryIds.includes(id)) {
        songs.put({ ...row, categoryIds: row.categoryIds.filter((categoryId) => categoryId !== id) });
        count += 1;
      }
    }
    return count;
  });
  notifyChange();
  return changed;
}

// --- Setlistler -------------------------------------------------------------

export async function listSetlists() {
  const rows = await transact(await init(), 'setlists', 'readonly', ({ setlists }) => result(setlists.getAll()));
  return rows.map(normalizeSetlist).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSetlist(id) {
  const row = await transact(await init(), 'setlists', 'readonly', ({ setlists }) => result(setlists.get(id)));
  return row ? normalizeSetlist(row) : null;
}

export async function createSetlist(name, songIds = []) {
  const setlist = await transact(await init(), 'setlists', 'readwrite', async ({ setlists }) => {
    const check = validateName(name, await result(setlists.getAll()), { label: 'Setlist adı' });
    if (!check.ok) throw Object.assign(new StorageError('invalid'), { detail: check.error });
    const now = Date.now();
    const created = normalizeSetlist({ id: createId(), name: check.name, songIds, createdAt: now, updatedAt: now });
    await result(setlists.add(created));
    return created;
  });
  notifyChange();
  return setlist;
}

/** Setlisti değiştirir: changes = { name?, songIds? } (songIds yeni sırayı verir). */
export async function updateSetlist(id, changes) {
  const setlist = await transact(await init(), 'setlists', 'readwrite', async ({ setlists }) => {
    const rows = await result(setlists.getAll());
    const row = rows.find((item) => item.id === id);
    if (!row) throw new StorageError('notFound');
    const updated = { ...row, updatedAt: Date.now() };
    if (changes.name !== undefined) {
      const check = validateName(changes.name, rows.filter((item) => item.id !== id), { label: 'Setlist adı' });
      if (!check.ok) throw Object.assign(new StorageError('invalid'), { detail: check.error });
      updated.name = check.name;
    }
    if (changes.songIds !== undefined) updated.songIds = changes.songIds;
    const normalized = normalizeSetlist(updated);
    await result(setlists.put(normalized));
    return normalized;
  });
  notifyChange();
  return setlist;
}

/** Setlisti siler; şarkılara dokunulmaz. */
export async function deleteSetlist(id) {
  await transact(await init(), 'setlists', 'readwrite', ({ setlists }) => result(setlists.delete(id)));
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
