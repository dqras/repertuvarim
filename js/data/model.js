/**
 * Şarkı ve kategori verisinin biçimi.
 * Veritabanından (ve ileride yedek dosyasından) gelen her kayıt buradan geçer;
 * eksik ya da hatalı alanlar güvenli varsayılan değerlerle doldurulur.
 * Bu dosya ekranlardan bağımsızdır; tests/model.test.mjs ile test edilir.
 */

const toText = (value) => (value === null || value === undefined ? '' : String(value));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Bir şarkının alanları:
 *   id, title (ad), artist (sanatçı), key (orijinal ton), categoryIds (kategoriler),
 *   capo, bpm (tempo), notes (kişisel notlar), favorite (favori mi),
 *   content (söz ve akorlar), isSample (örnek şarkı mı),
 *   createdAt / updatedAt (eklenme / değişme zamanı, milisaniye)
 */
export function normalizeSong(raw = {}) {
  const createdAt = isNumber(raw.createdAt) ? raw.createdAt : Date.now();
  return {
    id: toText(raw.id),
    title: toText(raw.title).trim(),
    artist: toText(raw.artist).trim(),
    key: toText(raw.key).trim(),
    categoryIds: Array.isArray(raw.categoryIds)
      ? [...new Set(raw.categoryIds.map(toText).filter(Boolean))]
      : [],
    capo: isNumber(raw.capo) && raw.capo > 0 ? raw.capo : 0,
    bpm: isNumber(raw.bpm) && raw.bpm > 0 ? raw.bpm : null,
    notes: toText(raw.notes),
    favorite: raw.favorite === true,
    content: toText(raw.content),
    isSample: raw.isSample === true,
    createdAt,
    updatedAt: isNumber(raw.updatedAt) ? raw.updatedAt : createdAt,
  };
}

/** Yeni kayıtlar için benzersiz kimlik. */
export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- Şarkı formu ------------------------------------------------------------

export const MAX_CAPO = 11;
export const MIN_BPM = 20;
export const MAX_BPM = 300;

/** Formun düzenlenebilen alanları. Yeni şarkı için boş form. */
export function emptySongForm() {
  return { title: '', artist: '', key: '', content: '', categoryIds: [], capo: 0, bpm: '', notes: '', favorite: false };
}

/** Kayıtlı bir şarkıdan form değerleri. */
export function songToForm(song) {
  return {
    title: song.title,
    artist: song.artist,
    key: song.key,
    content: song.content,
    categoryIds: [...song.categoryIds],
    capo: song.capo,
    bpm: song.bpm === null ? '' : String(song.bpm),
    notes: song.notes,
    favorite: song.favorite,
  };
}

/**
 * Ton yazımını düzenler: "am" → "Am", "f♯m" → "F#m", "Bb" → "Bb".
 * Boşsa '' döner; tanınmıyorsa null döner.
 */
export function normalizeKeyName(text) {
  const raw = toText(text).trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s+/g, '');
  if (!raw) return '';
  const match = /^([A-Ga-g])([#b]?)(m|min|-)?$/.exec(raw);
  if (!match) return null;
  return match[1].toUpperCase() + match[2] + (match[3] ? 'm' : '');
}

/**
 * Akor parantezlerinde sorun olan ilk satırın numarası (1'den başlar); sorun yoksa 0.
 * Her "[" aynı satırda bir "]" ile kapanmalı ve parantezler iç içe olmamalı.
 */
export function findBracketProblemLine(content) {
  const lines = toText(content).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    let open = false;
    for (const character of lines[index]) {
      if (character === '[') {
        if (open) return index + 1;
        open = true;
      } else if (character === ']') {
        if (!open) return index + 1;
        open = false;
      }
    }
    if (open) return index + 1;
  }
  return 0;
}

/**
 * Formu denetler. Sonuç:
 *   valid  → kaydedilebilir mi
 *   errors → { alan: 'kullanıcıya gösterilecek mesaj' }
 *   value  → kaydedilecek, düzenlenmiş değerler
 * Sözlerdeki boşluklara ve satır sonlarına dokunulmaz; yalnızca Windows satır sonları (\r\n) sadeleşir.
 */
export function validateSongForm(form) {
  const errors = {};

  const title = toText(form.title).trim();
  if (!title) errors.title = 'Şarkı adını yazın.';

  const content = toText(form.content).replace(/\r\n?/g, '\n');
  const problemLine = findBracketProblemLine(content);
  if (!content.trim()) errors.content = 'Sözleri ve akorları yazın.';
  else if (problemLine) {
    errors.content = `${problemLine}. satırda bir akor parantezi eksik ya da fazla. Akorlar [Am] gibi yazılmalı.`;
  }

  const key = normalizeKeyName(form.key);
  if (key === null) errors.key = 'Ton tanınmadı. Am, C ya da F#m gibi yazın veya boş bırakın.';

  let bpm = null;
  const bpmText = toText(form.bpm).trim();
  if (bpmText) {
    const value = Number(bpmText);
    if (!Number.isInteger(value) || value < MIN_BPM || value > MAX_BPM) {
      errors.bpm = `Tempo ${MIN_BPM} ile ${MAX_BPM} arasında bir tam sayı olmalı.`;
    } else {
      bpm = value;
    }
  }

  const capo = Number(form.capo);
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      title,
      artist: toText(form.artist).trim(),
      key: key ?? '',
      content,
      categoryIds: Array.isArray(form.categoryIds) ? [...new Set(form.categoryIds.map(toText).filter(Boolean))] : [],
      capo: Number.isInteger(capo) && capo > 0 && capo <= MAX_CAPO ? capo : 0,
      bpm,
      notes: toText(form.notes),
      favorite: form.favorite === true,
    },
  };
}

/** İki form aynı mı? (Taslakta gerçekten değişiklik var mı diye bakmak için.) */
export function sameForm(a, b) {
  const pick = (form) => JSON.stringify([
    toText(form.title), toText(form.artist), toText(form.key), toText(form.content).replace(/\r\n?/g, '\n'),
    [...(form.categoryIds ?? [])].sort(), Number(form.capo) || 0, toText(form.bpm).trim(), toText(form.notes),
    form.favorite === true,
  ]);
  return pick(a) === pick(b);
}

/** Bir kategorinin alanları: id, name (ad), color (renk adı), order (sıra), createdAt. */
export function normalizeCategory(raw = {}, fallbackOrder = 0) {
  return {
    id: toText(raw.id),
    name: toText(raw.name).trim(),
    color: toText(raw.color) || 'slate',
    order: isNumber(raw.order) ? raw.order : fallbackOrder,
    createdAt: isNumber(raw.createdAt) ? raw.createdAt : Date.now(),
  };
}
