/**
 * Şarkı metni işlemleri (söz ve akorlar).
 *
 * Şarkılar şu biçimde saklanır: akor, çalındığı yere köşeli parantezle yazılır.
 *   [Am]Bu gece yine aklımdasın
 * Bu dosya:
 *  - metindeki akorları bulur ve tanınmayanları listeler,
 *  - bütün şarkıyı istenen yarım ses kadar taşır (sözlere dokunmadan),
 *  - akorları sözlerin üstündeki ayrı bir satırda olan metni (internetten kopyalanan
 *    akor sayfaları gibi) tanır ve [Am] biçimine çevirir.
 * Ekranlardan bağımsızdır; testleri: tests/song-text.test.mjs
 */
import {
  isAnnotation,
  isChord,
  keyName,
  normalizeSteps,
  parseChord,
  spellingForKey,
  transposeChord,
  transposeKey,
} from './chords.js';
import { cleanText, foldLetters } from '../lib/text.js';

const INLINE_CHORD = /\[([^\]\n]*)\]/g;
const TAB_WIDTH = 8;

/** Metindeki köşeli parantezli bütün akorlar: [{ index, length, inner }] */
export function findInlineChords(content) {
  return [...String(content ?? '').matchAll(INLINE_CHORD)].map((match) => ({
    index: match.index,
    length: match[0].length,
    inner: match[1],
  }));
}

/**
 * Akorları gözden geçirir.
 * Sonuç: { chords: [tanınan akorlar], unknown: [tanınmayanlar], emptyCount: boş [ ] sayısı }
 * (Listelerde her akor bir kez geçer, metindeki sırasıyla.)
 */
export function analyzeChords(content) {
  const chords = new Set();
  const unknown = new Set();
  let emptyCount = 0;
  for (const { inner } of findInlineChords(content)) {
    const text = inner.trim();
    if (!text) emptyCount += 1;
    else if (isAnnotation(text)) continue;
    else if (isChord(text, { lenient: true })) chords.add(text);
    else unknown.add(text);
  }
  return { chords: [...chords], unknown: [...unknown], emptyCount };
}

/** Ton belirtilmemişse şarkının ilk akorundan tahmin eder ("Am7" → "Am"). Bulamazsa ''. */
export function guessKey(content) {
  for (const { inner } of findInlineChords(content)) {
    const chord = parseChord(inner.trim(), { lenient: true });
    if (chord) return keyName(chord.rootPitch, chord.minor);
  }
  return '';
}

/**
 * Bütün şarkıyı taşır. Sözler, boşluklar ve satırlar aynen kalır; yalnızca akorlar değişir.
 * options.key: şarkının orijinal tonu (boşsa ilk akordan tahmin edilir).
 * options.spelling: 'sharp' | 'flat' verilirse hep o kullanılır; verilmezse hedef tonun
 *   armürüne göre seçilir (ör. G'den Ab'ye çıkınca akorlar bemolle yazılır).
 * Sonuç: { text, key: yeni ton (biliniyorsa), unknown: [taşınamayan akorlar] }
 * steps 0 ise ve özel bir yazım istenmediyse metin hiç değişmeden döner.
 */
export function transposeContent(content, steps, { key = '', spelling } = {}) {
  const text = String(content ?? '');
  const amount = normalizeSteps(steps);
  const sourceKey = key || guessKey(text);
  const targetKey = sourceKey ? transposeKey(sourceKey, amount) : null;
  const unknown = new Set();

  if (amount === 0 && !spelling) {
    for (const { inner } of findInlineChords(text)) {
      const value = inner.trim();
      if (value && !isAnnotation(value) && !isChord(value, { lenient: true })) unknown.add(value);
    }
    return { text, key: targetKey ?? '', unknown: [...unknown] };
  }

  const chosenSpelling = spelling ?? spellingForKey(targetKey ?? '');
  const result = text.replace(INLINE_CHORD, (whole, inner) => {
    const value = inner.trim();
    if (!value || isAnnotation(value)) return whole;
    const moved = transposeChord(value, amount, { spelling: chosenSpelling, lenient: true });
    if (!moved.ok) {
      unknown.add(value);
      return whole;
    }
    return `[${moved.text}]`;
  });
  return { text: result, key: targetKey ?? '', unknown: [...unknown] };
}

// --- Akorları ayrı satırda olan metni çevirme ----------------------------------

/**
 * "Nakarat", "Giriş:", "Ara Solo (x2)" gibi bölüm başlığı satırları.
 * Akor satırı bunlarla birleştirilmez; şarkı ekranında başlık olarak gösterilir.
 */
const SECTION_LABEL =
  /^\s*[[(]?\s*(?:nakarat|giriş|giris|ara\s*(?:müzik|muzik|solo|nağme|nagme)?|solo|kıta|kita|köprü|kopru|final|bitiş|bitis|intro|outro|verse|chorus|bridge|pre-?chorus|enst(?:rümantal|rumantal)?\.?)\s*\d*\s*[\])]?\s*(?:\(?\s*[x×]\s*\d+\s*\)?)?\s*:?\s*$/i;

/** Satır bir bölüm başlığı mı? (Nakarat, Giriş, Solo …) */
export function isSectionLabel(line) {
  return SECTION_LABEL.test(String(line ?? ''));
}

// Akor satırlarında akor sayılmayan ama satırı bozmayan işaretler (çizgi, bölü vb.)
const BAR_MARKS = /^(?:\|+|:?\|\|?:?|\/|-+|%|\.{1,3}|…|\*)$/;
const REPEAT_MARK = /^(?:\(?[x×]\d+\)?|\(?\d+[x×]\)?)$/i;

function expandTabs(line) {
  let out = '';
  for (const character of line) {
    if (character === '\t') out += ' '.repeat(TAB_WIDTH - (out.length % TAB_WIDTH));
    else out += character;
  }
  return out;
}

/**
 * Bir satır yalnızca akorlardan mı oluşuyor? Öyleyse akorları ve sütunlarını verir.
 * Satırın başında "Giriş:" gibi bir etiket olabilir. Köşeli parantez içeren satırlar
 * zaten çevrilmiş sayılır. Sonuç: null ya da { label, tokens: [{ column, text, kind }] }
 *   kind: 'chord' | 'repeat' (x2) | 'bar' (| / -)
 */
export function parseChordLine(line) {
  const value = expandTabs(cleanText(line));
  if (!value.trim() || /[[\]]/.test(value)) return null;
  const tokens = [...value.matchAll(/\S+/g)].map((match) => ({ column: match.index, text: match[0] }));

  let label = null;
  if (tokens.length > 1 && /^\S+:$/.test(tokens[0].text) && !isChord(tokens[0].text.slice(0, -1))) {
    label = tokens.shift();
  }

  let chordCount = 0;
  for (const token of tokens) {
    if (isChord(token.text)) {
      token.kind = 'chord';
      chordCount += 1;
    } else if (REPEAT_MARK.test(token.text) || /^N\.?C\.?$/i.test(token.text)) {
      token.kind = 'repeat';
    } else if (BAR_MARKS.test(token.text)) {
      token.kind = 'bar';
    } else {
      return null; // akor olmayan bir sözcük var: bu bir söz satırı
    }
  }
  return chordCount > 0 ? { label, tokens } : null;
}

/** Metinde [Am] biçimine çevrilebilecek kaç akor satırı var? */
export function countChordLines(content) {
  return String(content ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => parseChordLine(line) !== null).length;
}

/**
 * Akorları ayrı satırda olan metni [Am] biçimine çevirir.
 *  - Akor satırının altında bir söz satırı varsa, her akor sözde aynı sütundaki
 *    harfin önüne yerleştirilir ve akor satırı silinir.
 *  - Altında söz yoksa (ara müzik, giriş) satır olduğu yerde [Am] [F] biçimine çevrilir.
 *  - Diğer satırlara dokunulmaz.
 * Sonuç: { text, converted: çevrilen akor satırı sayısı }
 */
export function convertChordSheet(content) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let converted = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const chordLine = parseChordLine(lines[index]);
    if (!chordLine) {
      output.push(lines[index]);
      continue;
    }
    converted += 1;
    const next = lines[index + 1];
    const canMerge =
      !chordLine.label &&
      next !== undefined &&
      next.trim() !== '' &&
      !/[[\]]/.test(next) &&
      !parseChordLine(next) &&
      !isSectionLabel(next);

    if (canMerge) {
      output.push(mergeIntoLyric(chordLine.tokens, expandTabs(cleanText(next))));
      index += 1; // söz satırı birleştirildi
    } else {
      output.push(convertInPlace(chordLine, expandTabs(cleanText(lines[index]))));
    }
  }
  return { text: output.join('\n'), converted };
}

/** Akorları söz satırında aynı sütundaki harflerin önüne yerleştirir. */
function mergeIntoLyric(tokens, lyric) {
  const chords = tokens.filter((token) => token.kind === 'chord');
  const repeats = tokens.filter((token) => token.kind === 'repeat').map((token) => token.text);
  const lastColumn = Math.max(...chords.map((token) => token.column));
  let line = lyric.length < lastColumn ? lyric.padEnd(lastColumn, ' ') : lyric;
  // Sağdan sola eklenir ki önceki eklemeler sütunları kaydırmasın.
  for (const token of [...chords].sort((a, b) => b.column - a.column)) {
    line = `${line.slice(0, token.column)}[${token.text}]${line.slice(token.column)}`;
  }
  return repeats.length ? `${line.replace(/\s+$/, '')} ${repeats.join(' ')}` : line;
}

/** Söz satırı olmayan akor satırı: akorlar olduğu yerde köşeli paranteze alınır. */
function convertInPlace(chordLine, line) {
  let result = line;
  for (const token of [...chordLine.tokens].sort((a, b) => b.column - a.column)) {
    if (token.kind !== 'chord') continue;
    result = `${result.slice(0, token.column)}[${token.text}]${result.slice(token.column + token.text.length)}`;
  }
  return result.replace(/\s+$/, '');
}

// --- Sitelerden aktarım -------------------------------------------------------

/** Aktarma yer iminin panoya koyduğu metnin ilk satırı. */
export const IMPORT_HEADER = 'Repertuvarım aktarım';

/**
 * Aktarma yer iminden gelen metni çözer. Biçim:
 *   Repertuvarım aktarım
 *   Şarkı: …
 *   Sanatçı: …
 *   Ton: …
 *   Kaynak: …
 *   (boş satır)
 *   akorlar ve sözler (akorlar ayrı satırlarda)
 * Akorlar [Am] biçimine çevrilmiş olarak döner.
 * Metin bu biçimde değilse null döner.
 */
export function parseImport(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() !== '');
  if (start === -1 || foldLetters(lines[start]).trim() !== foldLetters(IMPORT_HEADER)) return null;

  const fields = { title: '', artist: '', key: '', source: '' };
  const names = { 'şarki': 'title', 'sanatçi': 'artist', ton: 'key', kaynak: 'source' };
  let index = start + 1;
  for (; index < lines.length; index += 1) {
    const match = /^\s*([^:]+):\s*(.*)$/.exec(lines[index]);
    const name = match && names[foldLetters(match[1]).trim()];
    if (!name) break;
    fields[name] = match[2].trim();
  }
  while (index < lines.length && lines[index].trim() === '') index += 1;

  const body = lines.slice(index).join('\n').replace(/ /g, ' ').replace(/\s+$/, '');
  return { ...fields, content: convertChordSheet(body).text };
}
