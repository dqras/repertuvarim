/**
 * Ekran görüntüsünden okunan yazıyı (OCR sonucu) akor sayfasına çevirir.
 *
 * Girdi, OCR'ın bulduğu kelimeler ve her harfin görüntüdeki kutusudur (tesseract.js
 * biçiminde: blocks → paragraphs → lines → words → symbols, her birinde bbox).
 * Çıktı, akorların ayrı satırlarda durduğu düz metindir; akor satırındaki boşluklar,
 * her akorun görüntüde altındaki sözün hangi harfinin üstünde durduğuna göre
 * ayarlanır. Bu metin song-text.js convertChordSheet ile [Am] biçimine çevrilir.
 *
 * Neden harf kutuları? Ekran görüntüsündeki yazı tipi her uygulamada farklıdır;
 * boşluk saymak akoru kaydırır, görüntüdeki yeri ölçmek ise akoru tam o heceye koyar.
 */
import { isAnnotation, isChord } from './chords.js';

/** OCR sonucundaki bütün kelimeleri düz bir listeye çevirir. */
function collectWords(data) {
  const lines = data?.blocks
    ? data.blocks.flatMap((block) => (block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? []))
    : data?.lines ?? [];
  const words = [];
  for (const line of lines) {
    for (const word of line.words ?? []) {
      if (!word?.bbox || !String(word.text ?? '').trim()) continue;
      words.push(word);
    }
  }
  return words;
}

const height = (box) => box.y1 - box.y0;
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

/** Kelimeleri dikey konumlarına göre satırlara toplar (aynı hizadakiler aynı satır). */
function groupRows(words) {
  const sorted = [...words].sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
  const rows = [];
  for (const word of sorted) {
    const center = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows.find((r) => center > r.y0 && center < r.y1);
    if (row) {
      row.words.push(word);
      row.y0 = Math.min(row.y0, word.bbox.y0);
      row.y1 = Math.max(row.y1, word.bbox.y1);
    } else {
      rows.push({ y0: word.bbox.y0, y1: word.bbox.y1, words: [word] });
    }
  }
  for (const row of rows) row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return rows.sort((a, b) => a.y0 - b.y0);
}

/**
 * Bir kelimenin harflerini temizler: görünmez kadar ince "harfleri" atar ve aynı harfin
 * üst üste iki kez okunmasını (C ile c gibi) teke indirir.
 */
function cleanSymbols(word, rowHeight) {
  const text = String(word.text).trim();
  let symbols = (word.symbols ?? []).filter((s) => s?.bbox && String(s.text ?? '').trim());
  if (symbols.map((s) => s.text).join('') !== text || !symbols.length) {
    // Harf kutuları yoksa ya da kelimeyle uyuşmuyorsa kelimenin kutusunu harflere eşit böl.
    const chars = [...text];
    const width = (word.bbox.x1 - word.bbox.x0) / Math.max(chars.length, 1);
    symbols = chars.map((ch, i) => ({
      text: ch,
      bbox: { x0: word.bbox.x0 + i * width, x1: word.bbox.x0 + (i + 1) * width, y0: word.bbox.y0, y1: word.bbox.y1 },
    }));
  }
  const out = [];
  for (const symbol of symbols) {
    const width = symbol.bbox.x1 - symbol.bbox.x0;
    if (width < rowHeight * 0.12 && !/[ıil1|!.,:;'’]/.test(symbol.text)) continue; // hayalet harf
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.text.toLocaleLowerCase('tr-TR') === symbol.text.toLocaleLowerCase('tr-TR') &&
      prev.text !== symbol.text &&
      symbol.bbox.x0 - prev.bbox.x0 < (prev.bbox.x1 - prev.bbox.x0) * 0.95
    ) {
      // Aynı harf iki kez okunmuş (C ve c): büyük harfi tut, kutuları birleştir.
      const upper = /\p{Lu}/u.test(symbol.text) ? symbol.text : prev.text;
      out[out.length - 1] = {
        text: upper,
        bbox: { ...prev.bbox, x0: Math.min(prev.bbox.x0, symbol.bbox.x0), x1: Math.max(prev.bbox.x1, symbol.bbox.x1) },
      };
      continue;
    }
    out.push({ text: symbol.text, bbox: symbol.bbox });
  }
  return out;
}

/** Kelimeyi, harfler arasında büyük boşluk varsa parçalara böler. */
function splitAtGaps(symbols, rowHeight) {
  const parts = [];
  let current = [];
  for (const symbol of symbols) {
    const prev = current[current.length - 1];
    if (prev && symbol.bbox.x0 - prev.bbox.x1 > rowHeight * 0.45) {
      parts.push(current);
      current = [];
    }
    current.push(symbol);
  }
  if (current.length) parts.push(current);
  return parts;
}

const OCR_LOOKALIKES = [
  [/^0/, 'D'], [/^O/, 'D'], [/^6/, 'G'], [/^8/, 'B'], [/rn/g, 'm'], [/^([A-G])8/, '$1b'], [/^([A-G])H/, '$1#'],
];

/** OCR'ın okuduğu bir parçayı akora çevirmeye çalışır; olmazsa null. */
export function fixChordToken(raw) {
  const text = String(raw ?? '').replace(/^[([{|]+|[)\]}|.,:;]+$/g, '').trim();
  if (!text) return null;
  if (isChord(text) || isAnnotation(text)) return text;
  const candidates = [];
  const capital = text[0].toUpperCase() + text.slice(1);
  candidates.push(capital);
  candidates.push(capital.replace(/^([A-G])\1/i, '$1')); // "Cc" → "C"
  for (const [pattern, replacement] of OCR_LOOKALIKES) candidates.push(capital.replace(pattern, replacement));
  for (const candidate of candidates) if (candidate && isChord(candidate)) return candidate;
  return null;
}

/** Birleşik okunmuş iki akoru ayırır ("BbmC" → ["Bbm", "C"]); olmazsa null. */
function splitJoinedChords(text) {
  for (let cut = text.length - 1; cut >= 1; cut -= 1) {
    const left = fixChordToken(text.slice(0, cut));
    const right = fixChordToken(text.slice(cut));
    if (left && right) return [left, right, cut];
  }
  return null;
}

/** Satırı parçalara (token) ayırır: her biri metni ve harf kutularıyla. */
function rowTokens(row, rowHeight) {
  const tokens = [];
  for (const word of row.words) {
    const symbols = cleanSymbols(word, rowHeight);
    for (const part of splitAtGaps(symbols, rowHeight)) {
      tokens.push({ text: part.map((s) => s.text).join(''), symbols: part, confidence: word.confidence ?? 100 });
    }
  }
  return tokens;
}

/** Satır akor satırı mı? Öyleyse akorları (metin ve x konumu) döndürür, değilse null. */
function readChordRow(tokens) {
  const chords = [];
  let bad = 0;
  for (const token of tokens) {
    const fixed = fixChordToken(token.text);
    if (fixed) {
      chords.push({ text: fixed, x: token.symbols[0].bbox.x0 });
      continue;
    }
    const joined = splitJoinedChords(token.text);
    if (joined) {
      const [left, right, cut] = joined;
      chords.push({ text: left, x: token.symbols[0].bbox.x0 });
      chords.push({ text: right, x: token.symbols[cut].bbox.x0 });
      continue;
    }
    if (/^[\p{P}\p{S}]+$/u.test(token.text)) continue; // · + gibi işaretler
    bad += 1;
  }
  if (!chords.length || bad > 0) return null;
  return chords;
}

/** Söz satırının harfleri ve görüntüdeki yerleri (kelimeler tek boşlukla). */
function lyricChars(tokens) {
  const chars = [];
  tokens.forEach((token, index) => {
    if (index > 0) {
      const prev = chars[chars.length - 1];
      chars.push({ ch: ' ', x0: prev.x1, x1: token.symbols[0].bbox.x0 });
    }
    for (const symbol of token.symbols) {
      for (const ch of [...symbol.text]) chars.push({ ch, x0: symbol.bbox.x0, x1: symbol.bbox.x1 });
    }
  });
  return chars;
}

/** Akorları sütunlara dizer: her akor en az bir boşlukla ayrılır. */
function placeChords(chords, columnOf) {
  let line = '';
  for (const chord of chords) {
    let column = columnOf(chord.x);
    if (line.length) column = Math.max(column, line.length + 1);
    line += ' '.repeat(Math.max(0, column - line.length)) + chord.text;
  }
  return line;
}

/**
 * OCR sonucunu akor sayfası metnine çevirir.
 * Sonuç: { text, chordLines, lyricLines } — text, convertChordSheet'e verilecek düz metin.
 */
export function sheetFromOcr(data) {
  const words = collectWords(data);
  if (!words.length) return { text: '', chordLines: 0, lyricLines: 0 };
  const rows = groupRows(words);

  const lineHeight = median(rows.map((row) => median(row.words.map((w) => height(w.bbox))))) || 20;
  const parsed = rows.map((row) => {
    const h = median(row.words.map((w) => height(w.bbox))) || lineHeight;
    const tokens = rowTokens(row, h);
    const confidence = tokens.length ? tokens.reduce((sum, t) => sum + t.confidence, 0) / tokens.length : 0;
    return { ...row, h, tokens, confidence, chords: readChordRow(tokens) };
  });

  // Ekranın üstündeki saat, uygulama başlığı gibi satırlar: ilk akor satırından öncekileri at.
  const firstChord = parsed.findIndex((row) => row.chords);
  const usable = (firstChord > 0 ? parsed.slice(firstChord) : parsed).filter((row) => row.tokens.length && row.confidence >= 40);

  // Harf genişliği: bir harfin başından sonrakinin başına olan uzaklık (harfin mürekkebi değil).
  const charWidths = usable
    .filter((row) => !row.chords)
    .flatMap((row) => row.tokens.flatMap((t) => t.symbols.slice(1).map((s, k) => s.bbox.x0 - t.symbols[k].bbox.x0)))
    .filter((w) => w > 0);
  const charWidth = median(charWidths) || lineHeight * 0.5;
  const left = Math.min(...usable.map((row) => row.tokens[0]?.symbols[0]?.bbox.x0 ?? Infinity));

  // Önce her akor satırını altındaki söz satırıyla eşleştir (araları dar olmalı).
  const units = [];
  for (let i = 0; i < usable.length; i += 1) {
    const row = usable[i];
    const next = usable[i + 1];
    if (row.chords && next && !next.chords && next.y0 - row.y1 < lineHeight * 1.2) {
      units.push({ chords: row, lyric: next, y0: row.y0, y1: next.y1 });
      i += 1;
    } else {
      units.push(row.chords ? { chords: row, y0: row.y0, y1: row.y1 } : { lyric: row, y0: row.y0, y1: row.y1 });
    }
  }
  // Kıta araları: birimler arasındaki boşluk olağan aralığın belirgin biçimde üstündeyse boş satır.
  const gaps = units.slice(1).map((unit, i) => unit.y0 - units[i].y1);
  const usualGap = median(gaps);
  const breakGap = Math.max(usualGap * 1.6, usualGap + lineHeight * 0.6);

  const out = [];
  let chordLines = 0;
  let lyricLines = 0;
  units.forEach((unit, i) => {
    if (i > 0 && gaps[i - 1] > breakGap && out.length) out.push('');
    if (unit.chords && unit.lyric) {
      const chars = lyricChars(unit.lyric.tokens);
      // Akorun sol kenarı, sol kenarı ona en yakın harfin üstüne gelir.
      const columnOf = (x) => {
        const end = chars[chars.length - 1].x1;
        if (x > end - charWidth * 0.25) return chars.length + Math.max(0, Math.round((x - end) / charWidth));
        let best = 0;
        chars.forEach((c, k) => {
          if (Math.abs(c.x0 - x) < Math.abs(chars[best].x0 - x)) best = k;
        });
        return best;
      };
      out.push(placeChords(unit.chords.chords, columnOf));
      out.push(chars.map((c) => c.ch).join(''));
    } else if (unit.chords) {
      out.push(placeChords(unit.chords.chords, (x) => Math.max(0, Math.round((x - left) / charWidth))));
    } else {
      out.push(lyricChars(unit.lyric.tokens).map((c) => c.ch).join(''));
    }
    if (unit.chords) chordLines += 1;
    if (unit.lyric) lyricLines += 1;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  return { text: out.join('\n'), chordLines, lyricLines };
}
