import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixChordToken, sheetFromOcr } from '../js/music/ocr-sheet.js';
import { convertChordSheet } from '../js/music/song-text.js';

const CHAR = 20; // bir harfin genişliği (piksel)
const LINE = 40; // satır yüksekliği

/**
 * Sanal bir ekran: her satır { text, y } ya da { words: [{ text, col }] }.
 * OCR'ın vereceği biçimde kelime ve harf kutuları üretir. Harf genişlikleri isteğe bağlı
 * değişken (orantılı yazı tipi gibi).
 */
function screen(rows, { widthOf = () => CHAR, left = 30 } = {}) {
  const lines = [];
  let y = 100;
  for (const row of rows) {
    if (row.gap) {
      y += row.gap;
      continue;
    }
    const words = [];
    const text = row.text;
    let x = left;
    let i = 0;
    while (i < text.length) {
      if (text[i] === ' ') {
        x += widthOf(' ');
        i += 1;
        continue;
      }
      let j = i;
      const symbols = [];
      while (j < text.length && text[j] !== ' ') {
        const w = widthOf(text[j]);
        symbols.push({ text: text[j], confidence: 95, bbox: { x0: x + 1, x1: x + w - 1, y0: y, y1: y + LINE - 10 } });
        x += w;
        j += 1;
      }
      words.push({
        text: text.slice(i, j),
        confidence: 92,
        bbox: { x0: symbols[0].bbox.x0, x1: symbols[symbols.length - 1].bbox.x1, y0: y, y1: y + LINE - 10 },
        symbols,
      });
      i = j;
    }
    if (words.length) lines.push({ words, bbox: { x0: words[0].bbox.x0, x1: words[words.length - 1].bbox.x1, y0: y, y1: y + LINE - 10 } });
    y += row.pitch ?? LINE + 12;
  }
  return { blocks: [{ paragraphs: [{ lines }] }] };
}

test('akor adı düzeltmeleri', () => {
  assert.equal(fixChordToken('Am'), 'Am');
  assert.equal(fixChordToken('c'), 'C');
  assert.equal(fixChordToken('Cc'), 'C');
  assert.equal(fixChordToken('Arn'), 'Am');
  assert.equal(fixChordToken('6m'), 'Gm');
  assert.equal(fixChordToken('(x2)'), 'x2');
  assert.equal(fixChordToken('Gece'), null);
  assert.equal(fixChordToken('Ben'), null);
});

test('eşit genişlikli ekranda akorlar aynı sütuna yerleşir', () => {
  const sheet = [
    'Am          Dm',
    'Gece yarısı yollar',
    '    E7               Am',
    'Sessiz kaldı sokaklar',
  ];
  const data = screen(sheet.map((text) => ({ text, pitch: text.match(/^[A-G ]/) && /[a-z]{3}/.test(text) ? 52 : 26 })));
  const { text } = sheetFromOcr(data);
  assert.equal(convertChordSheet(text).text, convertChordSheet(sheet.join('\n')).text);
});

test('orantılı yazı tipinde akor, görüntüde altında durduğu harfe gelir', () => {
  // "W" çok geniş, "i" çok dar: sütun saymak yanlış olurdu, görüntüdeki yer doğruyu verir.
  const widthOf = (ch) => ({ W: 40, i: 8, ' ': 10 })[ch] ?? 20;
  // Akorlar, söz satırında "iii" kelimesinin başına (x = 30 + 4*40 + 10 = 200) ve "Wa"nın a'sına denk gelsin.
  const lyric = 'WWWW iii Wa';
  const data = {
    blocks: [{ paragraphs: [{ lines: [
      ...screen([{ text: 'Am' }], { widthOf: () => 20, left: 200 }).blocks[0].paragraphs[0].lines,
    ] }] }],
  };
  // ikinci akor: "Wa" içindeki "a" (x = 200 + 3*8 + 10 + 40 = 274)
  const chordLine = data.blocks[0].paragraphs[0].lines[0];
  const f = screen([{ text: 'F' }], { left: 274 }).blocks[0].paragraphs[0].lines[0].words[0];
  chordLine.words.push(f);
  const lyricLine = screen([{ gap: 40 }, { text: lyric }], { widthOf }).blocks[0].paragraphs[0].lines[0];
  data.blocks[0].paragraphs[0].lines.push(lyricLine);
  const { text } = sheetFromOcr(data);
  assert.equal(convertChordSheet(text).text, 'WWWW [Am]iii W[F]a');
});

test('üstteki saat ve başlık atılır, C ve c üst üste okunmuşsa teke iner, birleşik akorlar ayrılır', () => {
  const data = screen([
    { text: '11:14 LTE 81' },
    { text: '< Şarkılar' },
    // "Cc": aynı akor iki kez okunmuş; "DmG": iki akor bitişik okunmuş
    { text: 'Am  F  Cc      DmG', pitch: 26 },
    { text: 'Bir gece vakti yine geldi', pitch: 70 },
  ]);
  const { text } = sheetFromOcr(data);
  const result = convertChordSheet(text).text;
  assert.equal(result, '[Am]Bir [F]gec[C]e vakti [Dm]yin[G]e geldi');
  assert.ok(!result.includes('11:14'));
  assert.ok(!result.includes('Şarkılar'));
});

test('kıta araları boş satır olur, satır içi aralar olmaz', () => {
  const data = screen([
    { text: 'Am', pitch: 30 },
    { text: 'Bir iki üç', pitch: 50 },
    { text: 'Dm', pitch: 30 },
    { text: 'Dört beş altı', pitch: 120 },
    { text: 'E7', pitch: 30 },
    { text: 'Yedi sekiz', pitch: 50 },
  ]);
  const { text } = sheetFromOcr(data);
  assert.equal(convertChordSheet(text).text, '[Am]Bir iki üç\n[Dm]Dört beş altı\n\n[E7]Yedi sekiz');
});

test('boş görüntü boş sonuç verir', () => {
  assert.deepEqual(sheetFromOcr({ blocks: [] }), { text: '', chordLines: 0, lyricLines: 0 });
});
