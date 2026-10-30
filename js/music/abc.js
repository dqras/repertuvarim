/**
 * ABC nota yazısını uygulamanın notalarına çevirir.
 *
 * Fotoğraftan nota okuyucusu (LEGATO) sonucu ABC biçiminde verir, örneğin:
 *   X:1  T:…  L:1/8  M:4/4  K:F
 *   C C | C2 F F F2 E F | G A B G A4 | …
 * Buradan ad, ölçü, ton (donanım), anahtar ve ölçü ölçü notalar çıkarılır.
 *
 * Desteklenen: notalar (A–G, a–g, ' ve , ile oktav), değişim işaretleri (^ ^^ _ __ =,
 * ölçü sonuna kadar geçerli), süreler (2, /2, 3/2, / …), noktalı süreler, suslar (z x Z),
 * ölçü çizgileri, üçlemeler ((3), akorlar ([CEG] → en üstteki nota, yani ezgi), satır içi
 * [M:] [L:] [K:] alanları. Söz satırları (w:), süslemeler, çarpma notaları, akor adları
 * ("Am") ve yorumlar atlanır. Birden fazla ses (V:) varsa ilk ses alınır.
 */
import { fifthsOf, majorTonicOf, parseTime } from './notation.js';

const LETTERS = 'CDEFGAB';
const MODE_SHIFT = { maj: 0, ion: 0, '': 0, m: -3, min: -3, aeo: -3, mix: -1, dor: -2, phr: -4, lyd: 1, loc: -5, exp: 0 };

/** "F", "Dm", "Bbmin", "F#", "Ddor", "C clef=bass" → { key, fifths, clef } */
export function parseAbcKey(text) {
  const raw = String(text ?? '').trim();
  const clef = /clef\s*=\s*bass|\bbass\b/i.test(raw) ? 'bass' : 'treble';
  const m = /^([A-Ga-g])([#b]?)\s*([A-Za-z]*)/.exec(raw);
  if (!m || /^none$/i.test(raw)) return { key: { step: 0, alter: 0, mode: 'major' }, fifths: 0, clef };
  const step = 'CDEFGAB'.indexOf(m[1].toUpperCase());
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const modeWord = m[3].toLowerCase();
  const modeKey = modeWord === 'm' ? 'm' : modeWord.slice(0, 3);
  const shift = MODE_SHIFT[modeKey] ?? 0;
  const isMinor = modeKey === 'm' || modeKey === 'min' || modeKey === 'aeo';
  if (shift === 0 || isMinor) {
    const key = { step: [0, 1, 2, 3, 4, 5, 6][step], alter, mode: isMinor ? 'minor' : 'major' };
    // ABC harfleri İngilizce: C=do … B=si; uygulamada basamak 0=do … 6=si aynı sırada.
    const fifths = fifthsOf(key);
    if (fifths !== null) return { key, fifths, clef };
  }
  // Kilise modları (dor, mix…): aynı donanımlı majör ton olarak alınır.
  const base = fifthsOf({ step, alter, mode: 'major' }) ?? 0;
  const fifths = Math.max(-7, Math.min(7, base + shift));
  return { key: { ...majorTonicOf(fifths), mode: 'major' }, fifths, clef };
}

/** "1/8" → 0.125 (birlik notaya göre) */
function fraction(text, fallback) {
  const m = /^(\d+)\/(\d+)$/.exec(String(text ?? '').trim());
  return m ? Number(m[1]) / Number(m[2]) : fallback;
}

/** Bir sürenin (birlik notaya göre) yazılabilir parçaları: [{ dur, dots }] */
const SHAPES = [];
for (const dur of [1, 2, 4, 8, 16, 32]) {
  for (const dots of [0, 1, 2]) {
    if (dur === 32 && dots) continue;
    SHAPES.push({ dur, dots, value: (1 / dur) * (dots === 2 ? 1.75 : dots === 1 ? 1.5 : 1) });
  }
}
SHAPES.sort((a, b) => b.value - a.value);

export function splitLength(value) {
  const parts = [];
  let left = value;
  for (let guard = 0; left > 1 / 64 && guard < 8; guard += 1) {
    const exact = SHAPES.find((shape) => Math.abs(shape.value - left) < 1e-6);
    if (exact) {
      parts.push({ dur: exact.dur, dots: exact.dots });
      return parts;
    }
    const fit = SHAPES.find((shape) => shape.value <= left + 1e-6);
    if (!fit) break;
    parts.push({ dur: fit.dur, dots: fit.dots });
    left -= fit.value;
  }
  if (!parts.length) parts.push({ dur: 32, dots: 0 });
  return parts;
}

/**
 * ABC metnini çözer. Sonuç:
 * { title, composer, key, fifths, clef, time: '4/4', measures, warnings: [] }
 * measures: notation.js biçiminde (mutlak yükseklik: step, alter, octave, dur, dots, tup?)
 */
export function parseAbc(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = { title: '', composer: '', key: { step: 0, alter: 0, mode: 'major' }, fifths: 0, clef: 'treble', time: '4/4', measures: [], warnings: [] };
  let unit = null; // L:
  let meter = '4/4';
  let firstVoice = null;
  let currentVoice = null;
  const body = [];
  let inBody = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/%.*$/, '');
    const field = /^([A-Za-z]):\s*(.*)$/.exec(line.trim());
    if (field) {
      const [, name, value] = field;
      if (name === 'T' && !out.title) out.title = value.trim();
      else if (name === 'C' && !out.composer) out.composer = value.trim();
      else if (name === 'L') unit = fraction(value, unit);
      else if (name === 'M' && !inBody) meter = value.trim() === 'C' ? '4/4' : value.trim() === 'C|' ? '2/2' : value.trim();
      else if (name === 'K' && !inBody) {
        Object.assign(out, parseAbcKey(value));
        inBody = true;
      } else if (name === 'V') {
        const id = value.trim().split(/\s+/)[0];
        if (firstVoice === null) firstVoice = id;
        currentVoice = id;
        if (id === firstVoice && /clef\s*=\s*bass|\bbass\b/i.test(value)) out.clef = 'bass';
      }
      continue; // w: söz satırları ve diğer alanlar
    }
    if (!inBody || !line.trim()) continue;
    if (firstVoice !== null && currentVoice !== null && currentVoice !== firstVoice) continue;
    // Satır içi ses değişimi: [V:2] … ise o satırın kalanını atla
    body.push(line);
  }
  out.time = /^\d{1,2}\/(1|2|4|8|16)$/.test(meter) ? meter : '4/4';
  if (unit === null) {
    const t = parseTime(out.time);
    unit = t.num / t.den < 0.75 ? 1 / 16 : 1 / 8;
  }

  const tokens = body.join(' ');
  const measures = [];
  let measure = [];
  let tuplet = null;
  let skippedChords = 0;
  let pendingMeter = null; // satır içi [M:3/4]: sonraki ölçünün ilk notasına yazılır
  const pushItem = (item) => {
    if (pendingMeter && !measure.length) {
      item.meter = pendingMeter;
      pendingMeter = null;
    }
    if (tuplet) {
      item.tup = tuplet.n;
      item.tupPos = tuplet.n - tuplet.left;
      tuplet.left -= 1;
      if (tuplet.left <= 0) tuplet = null;
    }
    measure.push(item);
  };
  const endMeasure = () => {
    if (measure.length) measures.push(measure);
    measure = [];
    inMeasure.clear();
  };
  const inMeasure = new Map(); // "C4" → alter (ölçüdeki geçerli işaret)
  const signature = (letter) => {
    const step = LETTERS.indexOf(letter);
    const sharps = [3, 0, 4, 1, 5, 2, 6].slice(0, Math.max(0, out.fifths));
    const flats = [6, 2, 5, 1, 4, 0, 3].slice(0, Math.max(0, -out.fifths));
    return sharps.includes(step) ? 1 : flats.includes(step) ? -1 : 0;
  };

  // Nota: işaret? harf oktav* süre?
  const NOTE = /^(\^\^|\^|__|_|=)?([A-Ga-gzxZ])([,']*)(\d*)(\/*)(\d*)/;
  let i = 0;
  const s = tokens;
  while (i < s.length) {
    const ch = s[i];
    // Yoksayılanlar
    if (ch === '"') { const j = s.indexOf('"', i + 1); i = j === -1 ? s.length : j + 1; continue; }
    if (ch === '!' || ch === '+') { const j = s.indexOf(ch, i + 1); i = j === -1 ? s.length : j + 1; continue; }
    if (ch === '{') { const j = s.indexOf('}', i + 1); i = j === -1 ? s.length : j + 1; continue; }
    if (ch === '[' && /^\[[A-Za-z]:/.test(s.slice(i, i + 3))) {
      const j = s.indexOf(']', i);
      const inner = s.slice(i + 1, j === -1 ? s.length : j);
      const name = inner[0];
      const value = inner.slice(2);
      if (name === 'L') unit = fraction(value, unit);
      else if (name === 'M' && /^\d{1,2}\/(1|2|4|8|16)$/.test(value.trim())) {
        if (!measures.length && !measure.length) out.time = value.trim();
        else pendingMeter = value.trim();
      }
      else if (name === 'K') out.warnings.push('key-change');
      i = j === -1 ? s.length : j + 1;
      continue;
    }
    if (ch === '|' || (ch === ':' && /[|:]/.test(s[i + 1] ?? '')) || (ch === '[' && s[i + 1] === '|')) {
      // ölçü çizgisi ve tekrar işaretleri: | || |] [| |: :| ::  (hemen ardından gelen 1, 2 bitiş numarası)
      let j = i;
      while (j < s.length && /[|:\][]/.test(s[j]) && !(s[j] === '[' && /^\[[A-Za-z]:/.test(s.slice(j, j + 3)))) j += 1;
      while (j < s.length && /[0-9,-]/.test(s[j])) j += 1;
      endMeasure();
      i = j;
      continue;
    }
    if (ch === '[' && /\d/.test(s[i + 1] ?? '')) {
      i += 2; // [1 [2 bitişleri
      continue;
    }
    if (ch === ']') {
      i += 1;
      continue;
    }
    if (ch === '(' && /\d/.test(s[i + 1] ?? '')) {
      const m = /^\((\d)(?::\d*)?(?::\d*)?/.exec(s.slice(i));
      tuplet = { n: Number(m[1]), left: Number(m[1]) };
      i += m[0].length;
      continue;
    }
    if ('()-.~HLMOPSTuv$`>< \t&'.includes(ch)) { i += 1; continue; }
    if (ch === '[') {
      // akor: [CEG]2 → en üstteki nota (ezgi); süre akorun sonunda ya da ilk notada olabilir
      const j = s.indexOf(']', i);
      if (j === -1) { i += 1; continue; }
      const inner = s.slice(i + 1, j);
      const after = /^(\d*)(\/*)(\d*)/.exec(s.slice(j + 1));
      const notes = [...inner.matchAll(new RegExp(NOTE.source.slice(1), 'g'))].filter((n) => !/[zxZ]/.test(n[2]));
      if (notes.length) {
        const top = notes.reduce((best, n) => (pitchOf(n) > pitchOf(best) ? n : best));
        const lengthText = (after[0] || '') ? after : [null, top[4], top[5], top[6]];
        addNote(top[1], top[2], top[3], lengthText[1], lengthText[2], lengthText[3]);
        if (notes.length > 1) skippedChords += 1;
      }
      i = j + 1 + (after ? after[0].length : 0);
      continue;
    }
    const m = NOTE.exec(s.slice(i));
    if (m) {
      addNote(m[1], m[2], m[3], m[4], m[5], m[6]);
      i += m[0].length;
      continue;
    }
    i += 1; // tanınmayan karakter
  }
  endMeasure();

  function pitchOf(n) {
    const letter = n[2];
    let octave = letter === letter.toUpperCase() ? 4 : 5;
    for (const mark of n[3]) octave += mark === "'" ? 1 : -1;
    return octave * 7 + LETTERS.indexOf(letter.toUpperCase());
  }

  function addNote(accidental, letter, marks, num, slashes, den) {
    let length = unit;
    if (num) length *= Number(num);
    if (slashes) length /= den ? Number(den) : 2 ** slashes.length;
    if (letter === 'Z') {
      // Z4: dört ölçü sus
      const t = parseTime(out.time);
      const bars = Number(num) || 1;
      for (let k = 0; k < bars; k += 1) {
        for (const part of splitLength(t.num / t.den)) pushItem({ rest: true, ...part });
        endMeasure();
      }
      return;
    }
    const parts = splitLength(length);
    if (letter === 'z' || letter === 'x') {
      for (const part of parts) pushItem({ rest: true, ...part });
      return;
    }
    const upper = letter.toUpperCase();
    let octave = letter === upper ? 4 : 5;
    for (const mark of marks) octave += mark === "'" ? 1 : -1;
    const step = LETTERS.indexOf(upper);
    const slot = `${upper}${octave}`;
    let alter;
    if (accidental) {
      alter = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }[accidental];
      inMeasure.set(slot, alter);
    } else alter = inMeasure.has(slot) ? inMeasure.get(slot) : signature(upper);
    // ABC adım sırası C D E F G A B = uygulamadaki do re mi fa sol la si
    for (const part of parts) pushItem({ step, alter, octave, ...part });
  }

  out.measures = measures;
  if (skippedChords) out.warnings.push('chords');
  return out;
}

/** Okuyucunun (LEGATO) bazen eklediği "text" gibi yer tutucu adları temizler. */
export function cleanTitle(title) {
  const t = String(title ?? '').trim();
  return /^(text|title|untitled|x)$/i.test(t) ? '' : t;
}
