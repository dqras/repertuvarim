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
 * Ton: { step, alter, mode: 'major' | 'minor' }.
 * fifths: donanımdaki diyez (+) ya da bemol (−) sayısı.
 */
export function majorTonicOf(fifths) {
  const step = mod(fifths * 4, 7);
  const pc = mod(fifths * 7, 12);
  return { step, alter: pc - NATURAL[step] > 6 ? pc - NATURAL[step] - 12 : pc - NATURAL[step] < -6 ? pc - NATURAL[step] + 12 : pc - NATURAL[step] };
}

/** Tonun donanımındaki işaret sayısı (−7..7); geçersizse null. */
export function fifthsOf(key) {
  const major = key.mode === 'minor'
    ? { step: mod(key.step + 2, 7), pc: mod(NATURAL[key.step] + key.alter + 3, 12) }
    : { step: key.step, pc: mod(NATURAL[key.step] + key.alter, 12) };
  for (let f = -7; f <= 7; f += 1) {
    const t = majorTonicOf(f);
    if (t.step === major.step && mod(NATURAL[t.step] + t.alter, 12) === major.pc) return f;
  }
  return null;
}

/** Donanımın bir basamağa uyguladığı işaret (−1, 0, 1). */
export function signatureAlter(fifths, step) {
  if (fifths > 0 && SHARP_ORDER.slice(0, fifths).includes(step)) return 1;
  if (fifths < 0 && FLAT_ORDER.slice(0, -fifths).includes(step)) return -1;
  return 0;
}

/** Donanımdaki işaretlerin basamakları, çizim sırasıyla. */
export function signatureSteps(fifths) {
  return fifths >= 0 ? SHARP_ORDER.slice(0, fifths) : FLAT_ORDER.slice(0, -fifths);
}

const ALTER_SIGN = { '-2': '♭♭', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

/** "sol♯", "si♭" gibi nota adı. */
export function pitchLabel(step, alter = 0) {
  return STEP_NAMES[step] + (ALTER_SIGN[alter] ?? '');
}

/** "La minör", "Si♭ majör" */
export function keyLabel(key) {
  const name = pitchLabel(key.step, key.alter);
  return `${name[0].toLocaleUpperCase('tr-TR')}${name.slice(1)} ${key.mode === 'minor' ? 'minör' : 'majör'}`;
}

/** Donanımın kısa tarifi: "donanımsız", "2♯", "3♭" */
export function signatureLabel(fifths) {
  if (!fifths) return 'donanımsız';
  return fifths > 0 ? `${fifths}♯` : `${-fifths}♭`;
}

/** Bütün tonlar (donanıma göre), seçim listeleri için: { key, fifths, label } */
export function allKeys(mode) {
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
    out.push({ key, fifths: f, label: `${keyLabel(key)} (${signatureLabel(f)})` });
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

/** "la minör", "Sol majör", "mi bemol majör", "F#m" gibi yazılardan ton; tanınmazsa null. */
export function parseKeyText(text) {
  const raw = String(text ?? '').trim().toLocaleLowerCase('tr-TR')
    .replace(/♯|diyez/g, '#').replace(/♭|bemol/g, 'b').replace(/\s+/g, ' ');
  if (!raw) return null;
  let m = /^(do|re|mi|fa|sol|la|si) ?(#|b)? ?(majör|major|minör|minor)$/.exec(raw);
  if (m) return { step: STEP_NAMES.indexOf(m[1]), alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, mode: /min/.test(m[3]) ? 'minor' : 'major' };
  m = /^([a-g])(#|b)?(m)?$/.exec(raw);
  if (m) return { step: 'cdefgab'.indexOf(m[1]), alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, mode: m[3] ? 'minor' : 'major' };
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
  const fifths = fifthsOf(key) ?? 0;
  const tokens = String(code ?? '')
    .replace(/♯/g, '#').replace(/♭/g, 'b').replace(/♮/g, 'n').replace(/𝄪/g, 'x')
    .toLocaleLowerCase('tr-TR')
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
  const fifths = fifthsOf(key) ?? 0;
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

/** Ölçü süresi uymayan ölçüler (anacrouse için ilk ölçü hariç): [{ index, have, need }] */
export function measureProblems(measures, time) {
  let need = measureLength(time);
  const problems = [];
  measures.forEach((measure, index) => {
    if (measure[0]?.meter) need = measureLength(parseTime(measure[0].meter));
    const have = measure.reduce((sum, item) => sum + beats(item), 0);
    const isPickup = index === 0 && have < need;
    const isLast = index === measures.length - 1 && have < need;
    if (Math.abs(have - need) > 1e-6 && !isPickup && !isLast) problems.push({ index, have, need });
  });
  return problems;
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
  if (start === -1 || lines[start].trim().toLocaleLowerCase('tr-TR') !== SCORE_HEADER.toLocaleLowerCase('tr-TR')) return null;
  const out = { title: '', composer: '', key: null, time: '4/4', code: '' };
  const names = { ad: 'title', 'şarkı': 'title', besteci: 'composer', ton: 'key', 'ölçü': 'time', notalar: 'code' };
  let codeLines = null;
  for (const line of lines.slice(start + 1)) {
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    const m = /^\s*([^:]+):\s*(.*)$/.exec(line);
    const name = m && names[m[1].trim().toLocaleLowerCase('tr-TR')];
    if (!name) continue;
    if (name === 'code') codeLines = [m[2]];
    else if (name === 'key') out.key = parseKeyText(m[2]);
    else out[name] = m[2].trim();
  }
  out.code = (codeLines ?? []).join('\n').trim();
  return out;
}
