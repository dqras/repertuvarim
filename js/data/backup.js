/**
 * Yedekleme ve geri yükleme (internet gerekmez).
 *
 * Yedek dosyası düz bir JSON metnidir:
 *   { format: 'repertuvarim-yedek', version: 1, kind: 'full' | 'songs', exportedAt, appVersion,
 *     data: { songs: [...], categories: [...], setlists: [...], scores: [...] } }
 * Nota fotoğrafları dosyanın içine metin (base64) olarak gömülür.
 *
 * Geri yüklerken HİÇBİR KAYIT SİLİNMEZ: yedekteki kayıtlar mevcut kayıtlarla karşılaştırılır,
 *  - yeni olanlar eklenir,
 *  - aynısı zaten olanlar atlanır,
 *  - ikisinde de olup farklı olanlar için kullanıcı seçer: kendininkini koru / yedektekini
 *    kullan / ikisini de tut.
 * Bu dosya ekranlardan ve veritabanından bağımsızdır; testleri: tests/backup.test.mjs
 */
import { normalizeSong, normalizeCategory, normalizeSetlist, normalizeScore, createId } from './model.js';
import { foldForSearch } from '../lib/text.js';

export const BACKUP_FORMAT = 'repertuvarim-yedek';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

// --- Fotoğraflar: Blob ⇄ metin ---------------------------------------------------

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

function dataUrlToBlob(text) {
  const m = /^data:([^;,]*);base64,([A-Za-z0-9+/=\s]*)$/.exec(String(text ?? ''));
  if (!m) return null;
  try {
    const binary = atob(m[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'image/jpeg' });
  } catch {
    return null;
  }
}

// --- Dışa aktarma ------------------------------------------------------------------

/**
 * Yedek nesnesini oluşturur.
 * records: { songs, categories, setlists, scores } (repository'den okunmuş kayıtlar)
 * kind: 'full' (bütün repertuvar) ya da 'songs' (seçilen şarkılar ve kullandıkları kategoriler)
 */
export async function buildBackup(records, { kind = 'full', appVersion = '', now = Date.now() } = {}) {
  const songs = (records.songs ?? []).map(normalizeSong);
  const usedCategories = new Set(songs.flatMap((song) => song.categoryIds));
  const categories = (records.categories ?? [])
    .map((category, index) => normalizeCategory(category, index))
    .filter((category) => kind === 'full' || usedCategories.has(category.id));
  const setlists = kind === 'full' ? (records.setlists ?? []).map(normalizeSetlist) : [];
  const scores = [];
  if (kind === 'full') {
    for (const raw of records.scores ?? []) {
      const score = normalizeScore(raw);
      scores.push({ ...score, photo: score.photo ? await blobToDataUrl(score.photo) : null });
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kind,
    app: 'Repertuvarım',
    appVersion,
    exportedAt: new Date(now).toISOString(),
    counts: { songs: songs.length, categories: categories.length, setlists: setlists.length, scores: scores.length },
    data: { songs, categories, setlists, scores },
  };
}

/** Yedek dosyasının adı: repertuvarim-yedek-2026-10-31.json */
export function backupFileName({ kind = 'full', now = Date.now(), title = '' } = {}) {
  const date = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (kind === 'songs' && title) {
    const slug = foldForSearch(title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sarki';
    return `repertuvarim-${slug}-${day}.json`;
  }
  return `repertuvarim-${kind === 'songs' ? 'sarkilar' : 'yedek'}-${day}.json`;
}

// --- Dosyayı okuma ve denetleme ------------------------------------------------------

/**
 * Yedek dosyasının metnini çözer ve denetler. Hatalıysa anlaşılır bir BackupError fırlatır.
 * Sonuç: { kind, exportedAt, songs, categories, setlists, scores, skipped }
 *  skipped: bozuk olduğu için atlanan kayıt sayısı
 */
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(String(text ?? '').replace(/^﻿/, ''));
  } catch {
    throw new BackupError('Bu dosya okunamadı. Repertuvarım’dan alınmış bir yedek dosyası (.json) seçin.');
  }
  if (!raw || typeof raw !== 'object' || raw.format !== BACKUP_FORMAT) {
    throw new BackupError('Bu dosya bir Repertuvarım yedeği değil. “repertuvarim-yedek-….json” adlı dosyayı seçin.');
  }
  if (!Number.isInteger(raw.version) || raw.version > BACKUP_VERSION) {
    throw new BackupError('Bu yedek uygulamanın daha yeni bir sürümüyle alınmış. Önce uygulamayı güncelleyin (Durum ekranı), sonra tekrar deneyin.');
  }
  const data = raw.data;
  if (!data || typeof data !== 'object') throw new BackupError('Yedek dosyası bozuk: içinde kayıt bölümü yok.');
  const parts = { songs: 'şarkılar', categories: 'kategoriler', setlists: 'setlistler', scores: 'notalar' };
  for (const [name, label] of Object.entries(parts)) {
    if (data[name] !== undefined && !Array.isArray(data[name])) throw new BackupError(`Yedek dosyası bozuk: ${label} bölümü okunamadı.`);
  }

  let skipped = 0;
  const keep = (list, check, normalize) => {
    const out = [];
    for (const item of list ?? []) {
      if (!item || typeof item !== 'object' || !check(item)) {
        skipped += 1;
        continue;
      }
      out.push(normalize(item));
    }
    return out;
  };
  const text_ = (v) => typeof v === 'string' && v.trim() !== '';
  const songs = keep(data.songs, (s) => text_(s.title) && typeof s.content === 'string', (s) => normalizeSong({ ...s, id: text_(s.id) ? s.id : createId() }));
  const categories = keep(data.categories, (c) => text_(c.name), (c, i) => normalizeCategory({ ...c, id: text_(c.id) ? c.id : createId() }, i));
  const setlists = keep(data.setlists, (s) => text_(s.name), (s) => normalizeSetlist({ ...s, id: text_(s.id) ? s.id : createId() }));
  const scores = keep(data.scores, (s) => text_(s.title), (s) => ({
    ...normalizeScore({ ...s, id: text_(s.id) ? s.id : createId(), photo: null }),
    photo: s.photo ? dataUrlToBlob(s.photo) : null,
  }));

  if (!songs.length && !categories.length && !setlists.length && !scores.length) {
    throw new BackupError(skipped ? 'Yedekteki kayıtların hepsi bozuk; geri yüklenecek bir şey bulunamadı.' : 'Bu yedekte hiç kayıt yok.');
  }
  return { kind: raw.kind === 'songs' ? 'songs' : 'full', exportedAt: raw.exportedAt ?? null, songs, categories, setlists, scores, skipped };
}

// --- Karşılaştırma ve geri yükleme planı ---------------------------------------------

const fold = (text) => foldForSearch(text);
const songKey = (song) => `${fold(song.title)}|${fold(song.artist)}`;
const scoreKey = (score) => `${fold(score.title)}|${fold(score.composer)}`;

/** İki şarkının içeriği aynı mı? (favori ve tarih gibi alanlar önemsiz) */
function sameSong(a, b, categoryName) {
  const names = (song) => song.categoryIds.map(categoryName).filter(Boolean).sort().join(',');
  return a.title === b.title && a.artist === b.artist && a.key === b.key && a.content === b.content
    && a.notes === b.notes && a.capo === b.capo && a.bpm === b.bpm && names(a) === names(b);
}

function sameScore(a, b) {
  return a.title === b.title && a.composer === b.composer && a.code === b.code && a.time === b.time
    && a.clef === b.clef && a.notes === b.notes
    && a.key.step === b.key.step && a.key.alter === b.key.alter && a.key.mode === b.key.mode;
}

/**
 * Yedeği mevcut kayıtlarla karşılaştırır.
 * Sonuç: { songs, categories, setlists, scores } — her birinde
 *   added: [kayıt], same: [{ incoming, existing }], changed: [{ incoming, existing }]
 * Kategoriler adına göre eşleşir (aynı adlı kategori yeniden eklenmez).
 */
export function planRestore(backup, current) {
  current = {
    songs: current.songs.map(normalizeSong),
    categories: current.categories.map((c, i) => normalizeCategory(c, i)),
    setlists: current.setlists.map(normalizeSetlist),
    scores: current.scores.map(normalizeScore),
  };
  // Kategoriler
  const existingCategoryByName = new Map(current.categories.map((c) => [fold(c.name), c]));
  const categories = { added: [], same: [], changed: [] };
  const categoryIdMap = new Map(); // yedekteki id → bu cihazdaki id
  for (const incoming of backup.categories) {
    const existing = existingCategoryByName.get(fold(incoming.name));
    if (existing) {
      categories.same.push({ incoming, existing });
      categoryIdMap.set(incoming.id, existing.id);
    } else {
      categories.added.push(incoming);
      categoryIdMap.set(incoming.id, incoming.id);
    }
  }
  const incomingCategoryName = new Map(backup.categories.map((c) => [c.id, fold(c.name)]));
  const existingCategoryName = new Map(current.categories.map((c) => [c.id, fold(c.name)]));

  const match = (incomingList, existingList, keyOf) => {
    const byId = new Map(existingList.map((item) => [item.id, item]));
    const byKey = new Map(existingList.map((item) => [keyOf(item), item]));
    return (item) => byId.get(item.id) ?? byKey.get(keyOf(item)) ?? null;
  };

  const songs = { added: [], same: [], changed: [] };
  const findSong = match(backup.songs, current.songs, songKey);
  for (const incoming of backup.songs) {
    const existing = findSong(incoming);
    if (!existing) songs.added.push(incoming);
    else if (sameSong(incoming, existing, (id) => incomingCategoryName.get(id) ?? existingCategoryName.get(id))) songs.same.push({ incoming, existing });
    else songs.changed.push({ incoming, existing });
  }

  const scores = { added: [], same: [], changed: [] };
  const findScore = match(backup.scores, current.scores, scoreKey);
  for (const incoming of backup.scores) {
    const existing = findScore(incoming);
    if (!existing) scores.added.push(incoming);
    else if (sameScore(incoming, existing)) scores.same.push({ incoming, existing });
    else scores.changed.push({ incoming, existing });
  }

  // Setlistler: şarkılar bu cihazdaki karşılıklarıyla karşılaştırılır.
  const songIdMap = new Map();
  for (const { incoming, existing } of [...songs.same, ...songs.changed]) songIdMap.set(incoming.id, existing.id);
  const setlists = { added: [], same: [], changed: [] };
  const findSetlist = match(backup.setlists, current.setlists, (s) => fold(s.name));
  for (const incoming of backup.setlists) {
    const existing = findSetlist(incoming);
    if (!existing) {
      setlists.added.push(incoming);
      continue;
    }
    const ids = incoming.songIds.map((id) => songIdMap.get(id) ?? id);
    if (existing.name === incoming.name && ids.join(',') === existing.songIds.join(',')) setlists.same.push({ incoming, existing });
    else setlists.changed.push({ incoming, existing });
  }

  return { categories, songs, scores, setlists, categoryIdMap };
}

/** Planın kısa sayıları (ekranda gösterilir). */
export function summarizePlan(plan) {
  const count = (part) => ({
    added: part.added.length,
    same: part.same.length,
    changed: part.changed.length,
  });
  return { songs: count(plan.songs), categories: count(plan.categories), setlists: count(plan.setlists), scores: count(plan.scores) };
}

/** Bir adın bu listede kullanılmayan "(yedekten)" sürümü. */
function freeName(name, taken, suffix = ' (yedekten)') {
  const used = new Set([...taken].map(fold));
  let candidate = `${name}${suffix}`;
  for (let n = 2; used.has(fold(candidate)); n += 1) candidate = `${name}${suffix.replace(')', ` ${n})`)}`;
  return candidate;
}

/**
 * Planı yazılacak kayıtlara çevirir. Hiçbir kayıt silinmez.
 * choice (ikisinde de olup farklı olanlar için):
 *   'keep'    bu cihazdakini koru (yedektekini atla)
 *   'replace' bu cihazdakini yedektekiyle güncelle (aynı kayıt kalır, içeriği değişir)
 *   'both'    ikisini de tut (yedekteki "(yedekten)" adıyla ayrıca eklenir)
 * Sonuç: { songs, categories, setlists, scores } (put edilecek kayıtlar) ve counts.
 */
export function resolvePlan(plan, current, choice = 'keep', { now = Date.now() } = {}) {
  const out = { songs: [], categories: [], setlists: [], scores: [] };
  const counts = { added: 0, updated: 0, skipped: 0 };
  const existingIds = {
    songs: new Set(current.songs.map((s) => s.id)),
    categories: new Set(current.categories.map((c) => c.id)),
    setlists: new Set(current.setlists.map((s) => s.id)),
    scores: new Set(current.scores.map((s) => s.id)),
  };
  const freshId = (store, id) => {
    if (!existingIds[store].has(id)) {
      existingIds[store].add(id);
      return id;
    }
    const next = createId();
    existingIds[store].add(next);
    return next;
  };

  const categoryIdMap = new Map(plan.categoryIdMap);
  // Kategoriler: yalnızca yenileri eklenir, mevcutların sırası korunur.
  let order = current.categories.reduce((max, c) => Math.max(max, c.order ?? 0), -1) + 1;
  for (const incoming of plan.categories.added) {
    const id = freshId('categories', incoming.id);
    categoryIdMap.set(incoming.id, id);
    out.categories.push({ ...incoming, id, order: order++ });
    counts.added += 1;
  }
  const mapCategories = (ids) => [...new Set(ids.map((id) => categoryIdMap.get(id)).filter(Boolean))];

  // Şarkılar
  const songIdMap = new Map(); // yedekteki id → bu cihazdaki id
  for (const incoming of plan.songs.added) {
    const id = freshId('songs', incoming.id);
    songIdMap.set(incoming.id, id);
    out.songs.push({ ...incoming, id, categoryIds: mapCategories(incoming.categoryIds) });
    counts.added += 1;
  }
  for (const { incoming, existing } of plan.songs.same) {
    songIdMap.set(incoming.id, existing.id);
    counts.skipped += 1;
  }
  const songTitles = current.songs.map((s) => s.title);
  for (const { incoming, existing } of plan.songs.changed) {
    if (choice === 'replace') {
      songIdMap.set(incoming.id, existing.id);
      out.songs.push({ ...incoming, id: existing.id, isSample: false, createdAt: existing.createdAt, updatedAt: now, categoryIds: mapCategories(incoming.categoryIds) });
      counts.updated += 1;
    } else if (choice === 'both') {
      const id = freshId('songs', createId());
      songIdMap.set(incoming.id, id);
      const title = freeName(incoming.title, songTitles);
      songTitles.push(title);
      out.songs.push({ ...incoming, id, title, isSample: false, categoryIds: mapCategories(incoming.categoryIds) });
      counts.added += 1;
    } else {
      songIdMap.set(incoming.id, existing.id);
      counts.skipped += 1;
    }
  }

  // Notalar
  const scoreTitles = current.scores.map((s) => s.title);
  for (const incoming of plan.scores.added) {
    out.scores.push({ ...incoming, id: freshId('scores', incoming.id) });
    counts.added += 1;
  }
  counts.skipped += plan.scores.same.length;
  for (const { incoming, existing } of plan.scores.changed) {
    if (choice === 'replace') {
      out.scores.push({ ...incoming, id: existing.id, photo: incoming.photo ?? existing.photo ?? null, createdAt: existing.createdAt, updatedAt: now });
      counts.updated += 1;
    } else if (choice === 'both') {
      const title = freeName(incoming.title, scoreTitles);
      scoreTitles.push(title);
      out.scores.push({ ...incoming, id: freshId('scores', createId()), title });
      counts.added += 1;
    } else {
      counts.skipped += 1;
    }
  }

  // Setlistler: şarkılar bu cihazdaki karşılıklarına çevrilir, sıra korunur.
  const knownSongs = new Set([...current.songs.map((s) => s.id), ...out.songs.map((s) => s.id)]);
  const mapSongs = (ids) => [...new Set(ids.map((id) => songIdMap.get(id) ?? (existingIds.songs.has(id) ? id : null)).filter((id) => id && knownSongs.has(id)))];
  const setlistNames = current.setlists.map((s) => s.name);
  for (const incoming of plan.setlists.added) {
    const name = setlistNames.some((n) => fold(n) === fold(incoming.name)) ? freeName(incoming.name, setlistNames) : incoming.name;
    setlistNames.push(name);
    out.setlists.push({ ...incoming, id: freshId('setlists', incoming.id), name, songIds: mapSongs(incoming.songIds) });
    counts.added += 1;
  }
  counts.skipped += plan.setlists.same.length;
  for (const { incoming, existing } of plan.setlists.changed) {
    const songIds = mapSongs(incoming.songIds);
    if (choice === 'replace') {
      out.setlists.push({ ...existing, name: incoming.name, songIds, updatedAt: now });
      counts.updated += 1;
    } else if (choice === 'both') {
      const name = freeName(incoming.name, setlistNames);
      setlistNames.push(name);
      out.setlists.push({ ...incoming, id: freshId('setlists', createId()), name, songIds, createdAt: now, updatedAt: now });
      counts.added += 1;
    } else {
      counts.skipped += 1;
    }
  }
  return { ...out, counts };
}
