/**
 * Nota (porte) motoru: tonlar ve donanımlar, nota süreleri, ölçüler, transpoze.
 *
 * Bir besteyi "nota kodu" olarak yazarız; kod, kâğıttaki notayı GÖRDÜĞÜMÜZ gibi yazar:
 *   la4:4 si4 do5 re5 | mi5 fa5 sol#5 la5:2 |
 *   - ad: do re mi fa sol la si, ya da "sus" (es)
 *   - değişim işareti: # (diyez), b (bemol), n (natürel), ## ya da x (çift diyez), bb
 *   - oktav: 4 = orta do'nun oktavı (do4 orta do). Yazılmazsa bir önceki notaya en yakın oktav.
 *   - süre: :1 birlik, :2 ikilik, :4 dörtlük, :8 sekizlik, :16 on altılık, :32 otuz ikilik;
 *     sonuna "." noktalı (".." çift noktalı). Yazılmazsa bir önceki notanın süresi.
 *   - "|" ölçü çizgisi. Hiç ölçü çizgisi yoksa ölçüler, ölçü işaretine göre kendiliğinden bölünür.
 *   - "(3" sonraki 3 notanın üçleme olduğunu söyler (2, 3, 4, 5, 6, 7 olabilir).
 *   - "[3/4]" ölçü değişimi: bu noktadan sonraki ölçüler 3/4 (ölçünün ilk notası "meter" taşır).
 * Kâğıttaki gibi: donanımdaki işaretler kendiliğinden uygulanır (Sol majörde "fa" = fa diyez)
 * ve bir ölçüde konan işaret o ölçünün sonuna kadar geçerlidir.
 *
 * İçeride her nota MUTLAK yüksekliğiyle tutulur: { step 0..6 (do..si), alter -2..2, octave }.
 * Ekrana çizerken ve koda geri yazarken işaretler yine kâğıttaki kurallara göre hesaplanır.
 */

import { foldLetters } from '../lib/text.js';

export const STEP_NAMES = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
export const DURATIONS = [1, 2, 4, 8, 16, 32];
export const DURATION_NAMES = { 1: 'Birlik', 2: 'İkilik', 4: 'Dörtlük', 8: 'Sekizlik', 16: 'On altılık', 32: 'Otuz ikilik' };
export const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '2/2', '3/8', '5/8', '6/8', '7/8', '9/8', '12/8'];

const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // fa do sol re la mi si
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // si mi la re sol do fa

// --- Yükseklik yardımcıları ------------------------------------------------------

/** Diyatonik sıra: oktav*7 + basamak (do4 = 28). */
export const diatonic = (note) => note.octave * 7 + note.step;
/** MIDI numarası (do4 = 60). */
export const midi = (note) => 12 * (note.octave + 1) + NATURAL[note.step] + note.alter;
const mod = (n, m) => ((n % m) + m) % m;

// --- Tonlar ve donanım -------------------------------------------------------------

/**
 * Ton: { step, alter, mode }.
 * mode: 'major' | 'minor' ya da Türk müziği makamları 'hicaz' | 'rast' | 'nihavend'.
 * fifths: majör/minör donanımındaki diyez (+) ya da bemol (−) sayısı.
 *
 * Makamlar (12 sesli düzende, koma sesleri en yakın notayla yazılır):
 *  - Rast: majör dizinin donanımı (Sol Rast fa♯, Do Rast donanımsız, Re Rast fa♯ do♯).
 *  - Nihavend: doğal minörün donanımı (Sol Nihavend si♭ mi♭, La Nihavend donanımsız,
 *    Re Nihavend si♭, Do Nihavend mi♭ la♭ si♭).
 *  - Hicaz: kendine özgü donanım; 2. derece küçük, 3. derece büyük (artık ikili),
 *    4. ve 5. tam, 6. derece doğal harf (küçük ya da büyük altılı), 7. derece küçük:
 *    La Hicaz si♭ do♯, Mi Hicaz sol♯, Re Hicaz mi♭ fa♯, Sol Hicaz la♭.
 *    Donanımda bemol ve diyez birlikte olabilir.
 */
export const MAKAMS = ['hicaz', 'rast', 'nihavend'];
export const MODE_NAMES = { major: 'majör', minor: 'minör', hicaz: 'Hicaz', rast: 'Rast', nihavend: 'Nihavend' };
const BASE_MODE = { rast: 'major', nihavend: 'minor' };
export const isMakam = (key) => MAKAMS.includes(key?.mode);

export function majorTonicOf(fifths) {
  const step = mod(fifths * 4, 7);
  const pc = mod(fifths * 7, 12);
  return { step, alter: pc - NATURAL[step] > 6 ? pc - NATURAL[step] - 12 : pc - NATURAL[step] < -6 ? pc - NATURAL[step] + 12 : pc - NATURAL[step] };
}

/** Majör/minör (ve Rast/Nihavend) donanımındaki işaret sayısı (−7..7); Hicaz ya da geçersizse null. */
export function fifthsOf(key) {
  if (!key) return null;
  if (BASE_MODE[key.mode]) return fifthsOf({ ...key, mode: BASE_MODE[key.mode] });
  if (key.mode !== 'major' && key.mode !== 'minor') return null;
  const major = key.mode === 'minor'
    ? { step: mod(key.step + 2, 7), pc: mod(NATURAL[key.step] + key.alter + 3, 12) }
    : { step: key.step, pc: mod(NATURAL[key.step] + key.alter, 12) };
  for (let f = -7; f <= 7; f += 1) {
    const t = majorTonicOf(f);
    if (t.step === major.step && mod(NATURAL[t.step] + t.alter, 12) === major.pc) return f;
  }
  return null;
}

/** Hicaz donanımı: [{ step, alter }] (çizim sırasıyla); yazılamıyorsa null. */
function hicazMarks(key) {
  const tonic = NATURAL[key.step] + key.alter;
  const intervals = [0, 1, 4, 5, 7, null, 10];
  const marks = [];
  for (let degree = 0; degree < 7; degree += 1) {
    const step = (key.step + degree) % 7;
    const natural = NATURAL[step] + (key.step + degree >= 7 ? 12 : 0) - tonic;
    const alter = degree === 5
      ? (natural < 8 ? 8 - natural : natural > 9 ? 9 - natural : 0)
      : intervals[degree] - natural;
    if (Math.abs(alter) > 1) return null;
    if (alter) marks.push({ step, alter });
  }
  return sortMarks(marks);
}

/** Donanım işaretlerini kâğıttaki sıraya koyar: önce bemoller (si mi la …), sonra diyezler (fa do sol …). */
function sortMarks(marks) {
  const flats = FLAT_ORDER.map((step) => marks.find((m) => m.step === step && m.alter < 0)).filter(Boolean);
  const sharps = SHARP_ORDER.map((step) => marks.find((m) => m.step === step && m.alter > 0)).filter(Boolean);
  return [...flats, ...sharps];
}

/**
 * Tonun donanımı: majör/minör/Rast/Nihavend için işaret sayısı (sayı),
 * Hicaz için işaret listesi [{ step, alter }]. Geçersiz tonda null.
 */
export function signatureOf(key) {
  if (!key) return null;
  if (key.mode === 'hicaz') return hicazMarks(key);
  return fifthsOf(key);
}

/** Ton tanınıyor ve yazılabiliyor mu? */
export const isKnownKey = (key) => Boolean(key) && Number.isInteger(key.step) && signatureOf(key) !== null;

/** Donanımdaki işaretler, çizim sırasıyla: [{ step, alter }]. */
export function signatureMarks(signature) {
  if (Array.isArray(signature)) return signature;
  const fifths = Number(signature) || 0;
  return fifths >= 0
    ? SHARP_ORDER.slice(0, fifths).map((step) => ({ step, alter: 1 }))
    : FLAT_ORDER.slice(0, -fifths).map((step) => ({ step, alter: -1 }));
}

/** Donanımın bir basamağa uyguladığı işaret (−1, 0, 1). */
export function signatureAlter(signature, step) {
  return signatureMarks(signature).find((mark) => mark.step === step)?.alter ?? 0;
}

/** Donanımdaki işaretlerin basamakları, çizim sırasıyla. */
export function signatureSteps(signature) {
  return signatureMarks(signature).map((mark) => mark.step);
}

/** İki donanım aynı mı? (sayı ya da liste olabilir) */
export function sameSignature(a, b) {
  const text = (sig) => signatureMarks(sig).map((m) => `${m.step}:${m.alter}`).sort().join(' ');
  return text(a) === text(b);
}

const ALTER_SIGN = { '-2': '♭♭', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

/** "sol♯", "si♭" gibi nota adı. */
export function pitchLabel(step, alter = 0) {
  return STEP_NAMES[step] + (ALTER_SIGN[alter] ?? '');
}

/** "La minör", "Si♭ majör", "La Hicaz" */
export function keyLabel(key) {
  const name = pitchLabel(key.step, key.alter);
  return `${name[0].toLocaleUpperCase('tr-TR')}${name.slice(1)} ${MODE_NAMES[key.mode] ?? 'majör'}`;
}

/** Donanımın kısa tarifi: "donanımsız", "2♯", "3♭"; karışık donanımda "si♭ do♯". */
export function signatureLabel(signature) {
  if (Array.isArray(signature)) {
    return signature.length ? signature.map((m) => pitchLabel(m.step, m.alter)).join(' ') : 'donanımsız';
  }
  const fifths = Number(signature) || 0;
  if (!fifths) return 'donanımsız';
  return fifths > 0 ? `${fifths}♯` : `${-fifths}♭`;
}

// Hicaz için seçilebilecek 12 durak (çift işaret gerektirmeyen yazımlar).
const HICAZ_TONICS = [[0, 0], [0, 1], [1, 0], [2, -1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [6, -1], [6, 0]];

/** Bütün tonlar (donanıma göre), seçim listeleri için: { key, fifths, signature, label } */
export function allKeys(mode) {
  if (BASE_MODE[mode]) {
    return allKeys(BASE_MODE[mode]).map((item) => {
      const key = { ...item.key, mode };
      return { ...item, key, label: `${keyLabel(key)} (${signatureLabel(item.fifths)})` };
    });
  }
  if (mode === 'hicaz') {
    return HICAZ_TONICS.map(([step, alter]) => {
      const key = { step, alter, mode };
      const signature = hicazMarks(key);
      return { key, fifths: null, signature, label: `${keyLabel(key)} (${signatureLabel(signature)})` };
    });
  }
  const out = [];
  for (let f = -7; f <= 7; f += 1) {
    const major = majorTonicOf(f);
    const key = mode === 'minor'
      ? (() => {
          const step = mod(major.step - 2, 7);
          const pc = mod(NATURAL[major.step] + major.alter - 3, 12);
          let alter = pc - NATURAL[step];
          if (alter > 6) alter -= 12;
          if (alter < -6) alter += 12;
          return { step, alter, mode };
        })()
      : { ...major, mode };
    out.push({ key, fifths: f, signature: f, label: `${keyLabel(key)} (${signatureLabel(f)})` });
  }
  return out;
}

/** Transpoze için önerilen 12 ton: aynı türde, en az işaretli yazım. */
export function transposeTargets(mode) {
  const byPc = new Map();
  for (const item of allKeys(mode)) {
    const pc = mod(NATURAL[item.key.step] + item.key.alter, 12);
    const current = byPc.get(pc);
    // Eşit sayıda işarette (6♯ / 6♭) bemollü yazımı seç.
    if (!current || Math.abs(item.fifths) < Math.abs(current.fifths) || (Math.abs(item.fifths) === Math.abs(current.fifths) && item.fifths < 0)) {
      byPc.set(pc, item);
    }
  }
  return [...byPc.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
}

/**
 * "la minör", "Sol majör", "mi bemol majör", "F#m", "La Hicaz", "SOL RAST", "Sİ MİNÖR",
 * "Lam" (La minör), "Sib" gibi yazılardan ton; tanınmazsa null.
 */
export function parseKeyText(text) {
  const raw = foldLetters(text).trim()
    .replace(/♯|diyez/g, '#').replace(/♭|bemol/g, 'b').replace(/\s+/g, ' ');
  if (!raw) return null;
  const modeOf = (word) => {
    if (!word || /^(maj|major|majör)$/.test(word)) return 'major';
    if (/^(m|min|minor|minör|-)$/.test(word)) return 'minor';
    if (/^(hicaz|rast|nihavend|nihavent)$/.test(word)) return word === 'nihavent' ? 'nihavend' : word;
    return null;
  };
  let m = /^(do|re|mi|fa|sol|la|si) ?(#|b)? ?([a-zçğöşü-]*)$/.exec(raw);
  if (m) {
    const mode = modeOf(m[3]);
    if (mode) return { step: STEP_NAMES.indexOf(m[1]), alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, mode };
  }
  m = /^([a-g])(#|b)? ?([a-zçğöşü-]*)$/.exec(raw);
  if (m) {
    const mode = modeOf(m[3]);
    if (mode) return { step: 'cdefgab'.indexOf(m[1]), alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, mode };
  }
  return null;
}

// --- Süreler ve ölçüler -------------------------------------------------------------

/** Süre, dörtlük cinsinden (dörtlük = 1). */
export function beats(item) {
  const base = 4 / item.dur;
  return base * (item.dots === 2 ? 1.75 : item.dots === 1 ? 1.5 : 1) * tupletFactor(item.tup);
}

/** Üçleme gibi gruplar: n nota, şu kadar notanın süresinde çalınır (3 → 2'nin yerine). */
export const TUPLET_SPACE = { 2: 3, 3: 2, 4: 3, 5: 4, 6: 4, 7: 4 };
export function tupletFactor(n) {
  return n && TUPLET_SPACE[n] ? TUPLET_SPACE[n] / n : 1;
}

export function parseTime(text) {
  const m = /^(\d{1,2})\/(1|2|4|8|16)$/.exec(String(text ?? '').trim());
  return m ? { num: Number(m[1]), den: Number(m[2]) } : { num: 4, den: 4 };
}

/** Bir ölçünün süresi (dörtlük cinsinden). */
export const measureLength = (time) => (time.num * 4) / time.den;

// --- Nota kodu: çözme ---------------------------------------------------------------

const TOKEN = /^(do|re|mi|fa|sol|la|si|sus|es)(##|bb|x|#|b|n)?(\d)?(?::(1|2|4|8|16|32))?(\.{0,2})$/;
const WRITTEN_ALTER = { '##': 2, x: 2, '#': 1, b: -1, bb: -2, n: 0 };

/**
 * Nota kodunu çözer. key: ton, time: ölçü ({num, den}).
 * Sonuç: { measures: [[nota|sus, …], …], errors: [{ token, index, message }] }
 * nota: { step, alter, octave, dur, dots }   sus: { rest: true, dur, dots }
 */
export function parseNotes(code, key, time) {
  const fifths = signatureOf(key) ?? 0;
  const tokens = foldLetters(String(code ?? '')
    .replace(/♯/g, '#').replace(/♭/g, 'b').replace(/♮/g, 'n').replace(/𝄪/g, 'x'))
    .split(/\s+/)
    .filter(Boolean);
  const errors = [];
  const raw = []; // { kind: 'note'|'rest'|'bar', ... written }
  let dur = 4;
  let prev = null; // önceki nota (oktav tahmini için)
  let tuplet = null; // { n, left }
  const tag = (item) => {
    if (!tuplet) return item;
    item.tup = tuplet.n;
    item.tupPos = tuplet.n - tuplet.left;
    tuplet.left -= 1;
    if (tuplet.left <= 0) tuplet = null;
    return item;
  };
  tokens.forEach((token, index) => {
    if (/^\|+$/.test(token)) {
      raw.push({ kind: 'bar' });
      return;
    }
    const meterMatch = /^\[(\d{1,2}\/(?:1|2|4|8|16))\]$/.exec(token);
    if (meterMatch) {
      raw.push({ kind: 'meter', meter: meterMatch[1] });
      return;
    }
    const tupletMatch = /^\(([2-7])$/.exec(token);
    if (tupletMatch) {
      tuplet = { n: Number(tupletMatch[1]), left: Number(tupletMatch[1]) };
      return;
    }
    const m = TOKEN.exec(token);
    if (!m) {
      errors.push({ token, index, message: `“${token}” anlaşılmadı.` });
      return;
    }
    const [, name, accidental, octaveText, durText, dotText] = m;
    if (durText) dur = Number(durText);
    const dots = dotText.length;
    if (name === 'sus' || name === 'es') {
      raw.push(tag({ kind: 'rest', dur, dots }));
      return;
    }
    const step = STEP_NAMES.indexOf(name);
    let octave;
    if (octaveText) octave = Number(octaveText);
    else if (prev) {
      // önceki notaya en yakın oktav
      const target = diatonic(prev);
      octave = Math.round((target - step) / 7);
    } else octave = 4;
    const note = tag({ kind: 'note', step, octave, written: accidental === undefined ? null : WRITTEN_ALTER[accidental], dur, dots });
    raw.push(note);
    prev = note;
  });

  // Ölçülere böl
  const groups = [];
  const hasBars = raw.some((item) => item.kind === 'bar');
  let current = [];
  let filled = 0;
  let length = measureLength(time);
  let pendingMeter = null;
  for (const item of raw) {
    if (item.kind === 'bar') {
      if (current.length) groups.push(current);
      current = [];
      filled = 0;
      continue;
    }
    if (item.kind === 'meter') {
      if (current.length && !hasBars) {
        groups.push(current);
        current = [];
        filled = 0;
      }
      pendingMeter = item.meter;
      length = measureLength(parseTime(item.meter));
      continue;
    }
    if (pendingMeter && !current.length) {
      item.meter = pendingMeter;
      pendingMeter = null;
    }
    current.push(item);
    filled += beats(item);
    if (!hasBars && filled >= length - 1e-9) {
      groups.push(current);
      current = [];
      filled = 0;
    }
  }
  if (current.length) groups.push(current);

  // Kâğıttaki kurallar: donanım + ölçü içinde geçerli işaretler → mutlak yükseklik
  const measures = groups.map((group) => {
    const inMeasure = new Map();
    const extra = (item) => ({ ...(item.tup ? { tup: item.tup, tupPos: item.tupPos } : {}), ...(item.meter ? { meter: item.meter } : {}) });
    return group.map((item) => {
      if (item.kind === 'rest') return { rest: true, dur: item.dur, dots: item.dots, ...extra(item) };
      const slot = item.octave * 7 + item.step;
      let alter;
      if (item.written !== null) {
        alter = item.written;
        inMeasure.set(slot, alter);
      } else {
        alter = inMeasure.has(slot) ? inMeasure.get(slot) : signatureAlter(fifths, item.step);
      }
      return { step: item.step, alter, octave: item.octave, dur: item.dur, dots: item.dots, ...extra(item) };
    });
  });
  return { measures, errors };
}

/**
 * Her notaya, kâğıda yazılırken önüne konması gereken işareti ekler:
 * shown: null (işaret yok) ya da -2..2 (0 = natürel).
 */
export function withAccidentals(measures, fifths) {
  return measures.map((measure) => {
    const inMeasure = new Map();
    return measure.map((item) => {
      if (item.rest) return { ...item };
      const slot = diatonic(item);
      const current = inMeasure.has(slot) ? inMeasure.get(slot) : signatureAlter(fifths, item.step);
      const shown = item.alter === current ? null : item.alter;
      inMeasure.set(slot, item.alter);
      return { ...item, shown };
    });
  });
}

/** Notaları koda geri yazar (kâğıttaki gibi: yalnızca gereken işaretler). */
export function serializeNotes(measures, key) {
  const fifths = signatureOf(key) ?? 0;
  const SIGN = { '-2': 'bb', '-1': 'b', 0: 'n', 1: '#', 2: '##' };
  let lastDur = null;
  return withAccidentals(measures, fifths)
    .map((measure) =>
      measure
        .map((item) => {
          const dur = item.dur !== lastDur || item.dots ? `:${item.dur}${'.'.repeat(item.dots)}` : '';
          lastDur = item.dur;
          const prefix = (item.meter ? `[${item.meter}] ` : '') + (item.tup && item.tupPos === 0 ? `(${item.tup} ` : '');
          if (item.rest) return `${prefix}sus${dur}`;
          return `${prefix}${STEP_NAMES[item.step]}${item.shown === null ? '' : SIGN[item.shown]}${item.octave}${dur}`;
        })
        .join(' ')
    )
    .join(' | ')
    .concat(measures.length ? ' |' : '');
}

/**
 * Süresi ölçüye uymayan ölçüler: [{ index, have, need }].
 * Hata sayılmayanlar: baştaki eksik ölçü (anacrouse), sondaki eksik ölçü ve bir ölçünün
 * çift çizgiyle ikiye bölünmesi (art arda iki eksik ölçü birlikte tam bir ölçü ediyorsa).
 */
export function measureProblems(measures, time) {
  let need = measureLength(time);
  const info = measures.map((measure) => {
    if (measure[0]?.meter) need = measureLength(parseTime(measure[0].meter));
    return { have: measure.reduce((sum, item) => sum + beats(item), 0), need };
  });
  const ok = info.map(({ have, need: full }) => Math.abs(have - full) < 1e-6);
  for (let i = 0; i < info.length; i += 1) {
    if (ok[i]) continue;
    const { have, need: full } = info[i];
    if (have < full && i === 0) ok[i] = true;
    else if (have < full && i === info.length - 1) ok[i] = true;
    else if (have < full && i + 1 < info.length && !ok[i + 1] && Math.abs(have + info[i + 1].have - full) < 1e-6) {
      ok[i] = true;
      ok[i + 1] = true;
    }
  }
  return info.map((item, index) => ({ index, ...item })).filter((item) => !ok[item.index]);
}

// --- Transpoze ----------------------------------------------------------------------

/**
 * Kaynak tondan hedef tona aralık: { steps (diyatonik), semis (yarım ses) }.
 * octave: −1, 0, 1 ek oktav. Yön, en yakın olanı seçilir (en fazla 6 yarım ses).
 */
export function intervalBetween(from, to, octave = 0) {
  let steps = mod(to.step - from.step, 7);
  let semis = mod(NATURAL[to.step] + to.alter - (NATURAL[from.step] + from.alter), 12);
  if (steps === 0 && semis > 6) semis -= 12; // aynı harf: La → La♭ yarım ses aşağı
  else if (semis > 6 || (semis === 6 && steps > 3)) {
    steps -= 7;
    semis -= 12;
  }
  return { steps: steps + 7 * octave, semis: semis + 12 * octave };
}

/** Bir notayı aralık kadar taşır; harf adı aralığa göre değişir (doğru yazım). */
export function transposeNote(note, { steps, semis }) {
  if (note.rest) return { ...note };
  const dia = diatonic(note) + steps;
  const octave = Math.floor(dia / 7);
  const step = mod(dia, 7);
  const target = midi(note) + semis;
  let alter = target - (12 * (octave + 1) + NATURAL[step]);
  if (Math.abs(alter) <= 2) return { ...note, step, octave, alter };
  // Çok nadir: üçlü işaret gerekirse en yakın harfle yaz.
  const pc = mod(target, 12);
  const natural = NATURAL.indexOf(pc);
  if (natural !== -1) return { ...note, step: natural, octave: Math.floor(target / 12) - 1, alter: 0 };
  const lower = NATURAL.indexOf(pc - 1);
  return { ...note, step: lower, octave: Math.floor((target - 1) / 12) - 1, alter: 1 };
}

/** Bütün besteyi hedef tona taşır. Sonuç: { measures, key, fifths } */
export function transposeScore(measures, fromKey, toKey, octave = 0) {
  const interval = intervalBetween(fromKey, toKey, octave);
  return {
    measures: measures.map((measure) => measure.map((item) => transposeNote(item, interval))),
    key: { ...toKey, mode: fromKey.mode },
    fifths: fifthsOf({ ...toKey, mode: fromKey.mode }) ?? 0,
    signature: signatureOf({ ...toKey, mode: fromKey.mode }) ?? 0,
  };
}

// --- Aktarma metni (benim okuyup yazdığım ya da elle yazılan) ------------------------

export const SCORE_HEADER = 'Repertuvarım nota';

/**
 * "Repertuvarım nota" ile başlayan metni çözer:
 *   Repertuvarım nota
 *   Ad: …            Besteci: …         Ton: la minör      Ölçü: 4/4
 *   Notalar:
 *   la4:4 si4 do5 re5 | …
 * Sonuç: { title, composer, key, time, code } ya da null.
 */
export function parseScoreImport(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() !== '');
  if (start === -1 || foldLetters(lines[start]).trim() !== foldLetters(SCORE_HEADER)) return null;
  const out = { title: '', composer: '', key: null, time: '4/4', code: '' };
  const names = { ad: 'title', 'şarki': 'title', besteci: 'composer', ton: 'key', makam: 'key', 'ölçü': 'time', notalar: 'code' };
  let codeLines = null;
  for (const line of lines.slice(start + 1)) {
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    const m = /^\s*([^:]+):\s*(.*)$/.exec(line);
    const name = m && names[foldLetters(m[1]).trim()];
    if (!name) continue;
    if (name === 'code') codeLines = [m[2]];
    else if (name === 'key') out.key = parseKeyText(m[2]);
    else out[name] = m[2].trim();
  }
  out.code = (codeLines ?? []).join('\n').trim();
  return out;
}

/**
 * Ton seçimi değişince notaların nereye taşınacağı.
 * Aynı türde (minörden minöre) tonik tonik'e taşınır. Tür değişiyorsa (Do majör → La minör)
 * hedefin donanımı esas alınır: aynı donanımlı tonlar arasında notalar yerinde kalır
 * (yalnızca adı düzelir), farklı donanımda donanım farkı kadar taşınır.
 * Sonuç: kaynak türünde, hedefle aynı donanımlı ton.
 */
export function moveTarget(from, to) {
  if (from.mode === to.mode) return to;
  // Makama geçerken ya da makamdan çıkarken notalar yerinde kalır (yalnızca adı ve donanımı
  // değişir; donanıma uymayan sesler işaretle yazılır). Taşımak isterse kullanıcı ayrıca seçer.
  if (isMakam(from) || isMakam(to)) return from;
  const signature = signatureOf(to);
  const same = allKeys(from.mode).find((item) => sameSignature(item.signature, signature));
  if (same) return same.key;
  return { ...to, mode: from.mode };
}

/**
 * Okunan bir bestenin majör mü minör mü olduğunu tahmin eder (okuyucu yalnızca donanımı
 * görür; Do majör ile La minörü ayıramaz). Beste ilgili minörün tonik notasıyla bitiyorsa
 * ya da minörün yükseltilmiş 7. derecesi (La minörde sol♯) geçiyorsa minör sayılır.
 */
export function guessMode(measures, key) {
  if (key.mode !== 'major') return key;
  const fifths = fifthsOf(key);
  const minor = allKeys('minor').find((item) => item.fifths === fifths)?.key;
  if (!minor) return key;
  const notes = measures.flat().filter((item) => !item.rest);
  if (!notes.length) return key;
  const pc = (n) => mod(NATURAL[n.step] + n.alter, 12);
  const minorTonic = mod(NATURAL[minor.step] + minor.alter, 12);
  const majorTonic = mod(NATURAL[key.step] + key.alter, 12);
  const leading = mod(minorTonic - 1, 12); // La minörde sol♯
  const last = pc(notes[notes.length - 1]);
  const leadingCount = notes.filter((n) => pc(n) === leading).length;
  if (last === minorTonic) return minor;
  if (last !== majorTonic && leadingCount >= 2) return minor;
  return key;
}
