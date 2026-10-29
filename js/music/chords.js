/**
 * Transpoze motoru: akor adlarını tanır ve yarım ses adımlarıyla taşır.
 *
 * Bu dosya ekranlardan ve veritabanından tamamen bağımsızdır; yalnızca metin alır
 * ve metin döndürür. Testleri: tests/chords.test.mjs
 *
 * Kurallar:
 *  - Yalnızca kök nota ve (varsa) bölü işaretinden sonraki bas notası değişir;
 *    akorun türü (m, 7, maj7, sus4, m7b5, dim, add9 …) olduğu gibi korunur.
 *  - Tanınmayan bir akor değiştirilmez; sonuçta "tanınmadı" olarak bildirilir.
 *  - Diyez (#) mi bemol (b) mü yazılacağı:
 *      'sharp' → hep diyez, 'flat' → hep bemol,
 *      'auto'  → nota zaten diyezliyse diyez, bemolluyse bemol kalır; doğal
 *                notadan siyah tuşa geçince en yaygın yazım seçilir
 *                (C#, Eb, F#, Ab, Bb).
 *    Bütün bir şarkı taşınırken (song-text.js) yazım, hedef tonun armürüne göre seçilir.
 */

// Notaların yarım ses sırası (C = 0 … B = 11)
const LETTER_PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const COMMON_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/*
 * Akor türü (kök notadan sonraki kısım) bu parçalardan oluşabilir:
 * maj, min, dim, aug, sus, add, alt, no, M, m, Δ, °, ø, +, -, #, b, ♯, ♭, ^,
 * sayılar (2, 4, 5, 6, 7, 9, 11, 13 …), parantezler, virgül ve 6/9 gibi "/sayı".
 * Böylece "Ama", "Bu", "Do" gibi sözcükler akor sanılmaz.
 */
const SUFFIX = /^(?:maj|Maj|MAJ|min|dim|aug|sus|add|alt|no|M|m|Δ|°|ø|\+|-|#|b|♯|♭|\^|\d{1,2}|\(|\)|,|\/(?=\d))*$/;
const NOTE = /^([A-Ga-g])(#|b|♯|♭)?/;

/** Akor olmayan ama akor satırlarında ve köşeli parantez içinde sık görülen işaretler. */
const ANNOTATION = /^(?:N\.?C\.?|\(?[x×]\d+\)?|\(?\d+[x×]\)?|\|+|:?\|\|?:?|%|\/|-+|\.{1,3}|…|\*)$/i;

function noteFrom(text, lenient) {
  const match = NOTE.exec(text);
  if (!match) return null;
  const letter = match[1];
  if (!lenient && letter !== letter.toUpperCase()) return null;
  const accidental = match[2] === '♯' ? '#' : match[2] === '♭' ? 'b' : match[2] ?? '';
  const pitch = (LETTER_PITCH[letter.toUpperCase()] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + 12) % 12;
  return { pitch, accidental, length: match[0].length };
}

/**
 * Bir akor adını parçalarına ayırır. Tanınmazsa null döner.
 * lenient: true ise küçük harfle yazılmış kök de kabul edilir ("am" → A minör).
 * Sonuç: { rootPitch, rootAccidental, suffix, bassPitch, bassAccidental, minor }
 */
export function parseChord(text, { lenient = false } = {}) {
  const value = String(text ?? '').trim();
  const root = noteFrom(value, lenient);
  if (!root) return null;
  let rest = value.slice(root.length);

  // Bölü akor: son "/" işaretinden sonra bir nota varsa bas notasıdır (C/E, D/F#).
  let bass = null;
  const slash = rest.lastIndexOf('/');
  if (slash !== -1) {
    const candidate = noteFrom(rest.slice(slash + 1), lenient);
    if (candidate && candidate.length === rest.length - slash - 1) {
      bass = candidate;
      rest = rest.slice(0, slash);
    }
  }
  if (!SUFFIX.test(rest)) return null;

  return {
    rootPitch: root.pitch,
    rootAccidental: root.accidental,
    suffix: rest,
    bassPitch: bass ? bass.pitch : null,
    bassAccidental: bass ? bass.accidental : null,
    minor: isMinorSuffix(rest),
  };
}

/** Akor türü minör mü? (m, m7, min, -7 evet; maj7, M7 hayır) */
export function isMinorSuffix(suffix) {
  return /^(?:m(?!aj)|min|-)/.test(suffix);
}

/** Metin bir akor mu? */
export function isChord(text, options) {
  return parseChord(text, options) !== null;
}

/** Akor olmayan, taşınmayan ama uyarı da gerektirmeyen işaret mi? (N.C., x2, |, %) */
export function isAnnotation(text) {
  return ANNOTATION.test(String(text ?? '').trim());
}

/** Yarım ses numarasını (0–11) nota adına çevirir. */
export function pitchName(pitch, spelling = 'auto', originalAccidental = '') {
  const index = ((pitch % 12) + 12) % 12;
  if (spelling === 'sharp') return SHARP_NAMES[index];
  if (spelling === 'flat') return FLAT_NAMES[index];
  if (originalAccidental === '#') return SHARP_NAMES[index];
  if (originalAccidental === 'b') return FLAT_NAMES[index];
  return COMMON_NAMES[index];
}

/**
 * Tek bir akoru taşır.
 * steps: kaç yarım ses (+ yukarı, - aşağı). spelling: 'auto' | 'sharp' | 'flat'.
 * Sonuç: { ok: true, text } ya da tanınmazsa { ok: false, text: değişmemiş akor }.
 * steps 0 ise akor yazıldığı gibi döner.
 */
export function transposeChord(text, steps, { spelling = 'auto', lenient = false } = {}) {
  const original = String(text ?? '');
  const chord = parseChord(original, { lenient });
  if (!chord) return { ok: false, text: original };
  if (steps % 12 === 0 && spelling === 'auto') return { ok: true, text: original.trim() };
  const root = pitchName(chord.rootPitch + steps, spelling, chord.rootAccidental);
  const bass = chord.bassPitch === null ? '' : `/${pitchName(chord.bassPitch + steps, spelling, chord.bassAccidental)}`;
  return { ok: true, text: `${root}${chord.suffix}${bass}` };
}

// --- Tonlar ------------------------------------------------------------------

// Her yarım ses için en yaygın ton adı (majör ve minör ayrı).
const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEYS = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

// Tonun armürü: diyezli tonlarda akorlar diyezle, bemollü tonlarda bemolle yazılır.
const SHARP_KEYS = new Set(['G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m']);
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm']);

/** Ton adını çözer: "Am" → { pitch: 9, minor: true }. Tanınmazsa null. */
export function parseKey(text) {
  const chord = parseChord(text, { lenient: true });
  if (!chord || chord.bassPitch !== null) return null;
  if (!/^(?:m|min|-)?$/.test(chord.suffix)) return null;
  return { pitch: chord.rootPitch, minor: chord.minor };
}

/** Yarım ses ve majör/minör bilgisinden en yaygın ton adı. */
export function keyName(pitch, minor) {
  const index = ((pitch % 12) + 12) % 12;
  return minor ? MINOR_KEYS[index] : MAJOR_KEYS[index];
}

/** Tonu taşır: transposeKey('Am', 1) → 'Bbm'. Tanınmazsa null. */
export function transposeKey(key, steps) {
  const parsed = parseKey(key);
  return parsed ? keyName(parsed.pitch + steps, parsed.minor) : null;
}

/** Bir tonda akorların hangi işaretle yazılacağı: 'sharp' | 'flat' | 'auto' (C ve Am). */
export function spellingForKey(key) {
  const parsed = parseKey(key);
  if (!parsed) return 'auto';
  const name = keyName(parsed.pitch, parsed.minor);
  if (SHARP_KEYS.has(name)) return 'sharp';
  if (FLAT_KEYS.has(name)) return 'flat';
  return 'auto';
}

/**
 * Bir tondan diğerine kaç yarım ses: stepsBetweenKeys('Am', 'Cm') → 3.
 * Sonuç -5 ile +6 arasındadır (en kısa yol). Tonlardan biri tanınmazsa null.
 */
export function stepsBetweenKeys(fromKey, toKey) {
  const from = parseKey(fromKey);
  const to = parseKey(toKey);
  if (!from || !to) return null;
  return normalizeSteps(to.pitch - from.pitch);
}

/** Yarım ses sayısını -5 … +6 aralığına getirir (12 yarım ses = aynı ton). */
export function normalizeSteps(steps) {
  const value = ((Math.round(steps) % 12) + 12) % 12;
  return value > 6 ? value - 12 : value;
}

/** Bir tonun 12 hâli (seçim listesi için), aynı majör/minör türünde. */
export function keysLike(key) {
  const parsed = parseKey(key);
  const minor = parsed ? parsed.minor : false;
  return (minor ? MINOR_KEYS : MAJOR_KEYS).slice();
}
