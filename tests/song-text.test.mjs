// Şarkı metni işlemlerinin testleri: şarkıyı taşıma ve akor satırlarını çevirme.
// (Testlerdeki sözler uydurmadır.)
// Çalıştırmak için (Node.js kurulu bir bilgisayarda, proje klasöründe): node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeChords,
  convertChordSheet,
  countChordLines,
  findInlineChords,
  guessKey,
  parseChordLine,
  transposeContent,
} from '../js/music/song-text.js';

// --- Şarkıyı taşıma -------------------------------------------------------------

test('yalnızca akorlar değişir; sözler, boşluklar ve satırlar aynen kalır', () => {
  const song = '[Am]Bu gece   yine [F]aklımdasın\n\n  [C]Sensiz [G/B]geçen günler  ';
  const { text } = transposeContent(song, 2, { key: 'Am' });
  assert.equal(text, '[Bm]Bu gece   yine [G]aklımdasın\n\n  [D]Sensiz [A/C#]geçen günler  ');
});

test('0 adımda metin hiç değişmez (orijinal tona dönüş)', () => {
  const song = '[G]Bir [Bb]iki [A#]üç';
  assert.equal(transposeContent(song, 0, { key: 'G' }).text, song);
  assert.equal(transposeContent(song, 12, { key: 'G' }).text, song);
});

test('yukarı taşıyıp geri indirince orijinal metin elde edilir', () => {
  const song = '[Am]Bir [F]iki [C]üç [G]dört [E7]beş [Dm/F]altı';
  const up = transposeContent(song, 2, { key: 'Am' });
  assert.equal(transposeContent(up.text, -2, { key: up.key }).text, song);
  const down = transposeContent(song, -1, { key: 'Am' });
  assert.equal(transposeContent(down.text, 1, { key: down.key }).text, song);
});

test('yazım hedef tona göre seçilir', () => {
  // G → Ab (bemollü ton): C# değil Db yazılır.
  assert.deepEqual(transposeContent('[G]a [C]b [D]c [Em]d [Bm]e', 1, { key: 'G' }),
    { text: '[Ab]a [Db]b [Eb]c [Fm]d [Cm]e', key: 'Ab', unknown: [] });
  // Dm → Em (diyezli ton)
  assert.equal(transposeContent('[Dm]a [Gm]b [A7]c [Bb]d [C]e [F]f', 2, { key: 'Dm' }).text,
    '[Em]a [Am]b [B7]c [C]d [D]e [G]f');
  // E → F (bemollü ton)
  assert.equal(transposeContent('[E]a [A]b [B]c [C#m]d [G#m]e', 1, { key: 'E' }).text,
    '[F]a [Bb]b [C]c [Dm]d [Am]e');
});

test('ton yazılmamışsa ilk akordan tahmin edilir', () => {
  assert.equal(guessKey('Giriş\n[Am7]Bu [F]gece'), 'Am');
  assert.equal(guessKey('akorsuz'), '');
  const result = transposeContent('[Am]a [E7]b', 1);
  assert.deepEqual(result, { text: '[Bbm]a [F7]b', key: 'Bbm', unknown: [] });
});

test('istenirse hep diyez ya da hep bemol yazılır', () => {
  assert.equal(transposeContent('[C]a [F]b', 1, { key: 'C', spelling: 'sharp' }).text, '[C#]a [F#]b');
  assert.equal(transposeContent('[C]a [F]b', 1, { key: 'C', spelling: 'flat' }).text, '[Db]a [Gb]b');
});

test('tanınmayan akorlar bozulmaz ve bildirilir', () => {
  const result = transposeContent('[Hm]a [Am]b [Xyz]c [Hm]d', 2, { key: 'Am' });
  assert.equal(result.text, '[Hm]a [Bm]b [Xyz]c [Hm]d');
  assert.deepEqual(result.unknown, ['Hm', 'Xyz']);
});

test('akor olmayan işaretlere ve boş parantezlere dokunulmaz', () => {
  const song = '[N.C.]Sessiz [x2] [] [Am]söz';
  const result = transposeContent(song, 3, { key: 'Am' });
  assert.equal(result.text, '[N.C.]Sessiz [x2] [] [Cm]söz');
  assert.deepEqual(result.unknown, []);
});

test('akorları gözden geçirme', () => {
  assert.deepEqual(analyzeChords('[Am]a [Hm]b [] [N.C.] [Am] [ F ] [am]'),
    { chords: ['Am', 'F', 'am'], unknown: ['Hm'], emptyCount: 1 });
  assert.equal(findInlineChords('[Am]a\n[F]b').length, 2);
});

// --- Akor satırlarını [Am] biçimine çevirme --------------------------------------

test('akor satırı tanınır, söz satırı tanınmaz', () => {
  assert.ok(parseChordLine('Dm  Gm A          Dm  Gm A'));
  assert.ok(parseChordLine('   Am   F   C   G   x2'));
  assert.ok(parseChordLine('Giriş: Am F C G'));
  assert.equal(parseChordLine('Bu gece yine aklımdasın'), null);
  assert.equal(parseChordLine('A Bu Am'), null);
  assert.equal(parseChordLine('[Am]Bu gece'), null);
  assert.equal(parseChordLine('   '), null);
  assert.equal(parseChordLine('| / -'), null); // akor yok
});

test('akorlar, söz satırında aynı sütundaki harfin önüne yerleşir', () => {
  const sheet = [
    'Dm  Gm A          Dm  Gm A',
    'Gece yarısı yine sen varsın',
    '         Dm  Gm A',
    'Kapıda ayak sesleri',
  ].join('\n');
  assert.deepEqual(convertChordSheet(sheet), {
    // 2. akor satırında Dm 9., Gm 13., A 16. sütunda: "ay|ak", "s|esl", "sesl|eri"
    text: '[Dm]Gece[Gm] ya[A]rısı yine s[Dm]en v[Gm]ars[A]ın\nKapıda ay[Dm]ak s[Gm]esl[A]eri',
    converted: 2,
  });
});

test('söz satırından uzun akor satırında söz boşlukla uzatılır', () => {
  assert.equal(convertChordSheet('        Dm  Gm A\nBen').text, 'Ben     [Dm]    [Gm]   [A]');
});

test('altında söz olmayan akor satırı olduğu yerde çevrilir', () => {
  const sheet = 'Am   F   C   G\n\n[Am]Söz zaten çevrilmiş';
  assert.deepEqual(convertChordSheet(sheet), {
    text: '[Am]   [F]   [C]   [G]\n\n[Am]Söz zaten çevrilmiş',
    converted: 1,
  });
});

test('etiketli satır ("Giriş:") alttaki sözle birleştirilmez', () => {
  assert.equal(convertChordSheet('Giriş: Am F | C G\nBu gece').text, 'Giriş: [Am] [F] | [C] [G]\nBu gece');
});

test('arka arkaya iki akor satırı: ilki olduğu yerde, ikincisi sözle', () => {
  assert.equal(convertChordSheet('Am  F\nC   G\nSöz satırı').text, '[Am]  [F]\n[C]Söz [G]satırı');
});

test('tekrar işareti satır sonuna eklenir, sekmeler boşluğa çevrilir', () => {
  // F 8. sütunda: "yin|e"; sekme de 8. sütuna kadar boşluk sayılır.
  assert.equal(convertChordSheet('Am      F  x2\nYine yine yine').text, '[Am]Yine yin[F]e yine x2');
  assert.equal(convertChordSheet('Am\tF\nYine yine yine').text, '[Am]Yine yin[F]e yine');
});

test('zaten çevrilmiş metin değişmez; satır sonları korunur', () => {
  const song = '[Am]Bu gece\r\n\r\n[F]Sensiz';
  assert.deepEqual(convertChordSheet(song), { text: '[Am]Bu gece\n\n[F]Sensiz', converted: 0 });
  assert.equal(countChordLines(song), 0);
  assert.equal(countChordLines('Am F\nSöz\n\nC G\nSöz'), 2);
});

test('çevrilen metin tekrar çevrilince değişmez', () => {
  const once = convertChordSheet('Dm  Gm A\nGece yarısı\n\nAm F').text;
  assert.equal(convertChordSheet(once).text, once);
  assert.equal(convertChordSheet(once).converted, 0);
});
