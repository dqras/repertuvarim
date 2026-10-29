// Transpoze motorunun testleri.
// Çalıştırmak için (Node.js kurulu bir bilgisayarda, proje klasöründe): node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChord,
  isChord,
  isAnnotation,
  transposeChord,
  transposeKey,
  parseKey,
  spellingForKey,
  stepsBetweenKeys,
  normalizeSteps,
  keysLike,
} from '../js/music/chords.js';

const up = (chord, steps, options) => transposeChord(chord, steps, options).text;

// --- Proje planındaki test durumları (8. bölüm) --------------------------------

test('plan: Am bir yarım ses yukarı → Bbm', () => assert.equal(up('Am', 1), 'Bbm'));
test('plan: Am iki yarım ses yukarı → Bm', () => assert.equal(up('Am', 2), 'Bm'));
test('plan: G iki yarım ses yukarı → A', () => assert.equal(up('G', 2), 'A'));
test('plan: F#m7 iki yarım ses yukarı → G#m7', () => assert.equal(up('F#m7', 2), 'G#m7'));
test('plan: C/E iki yarım ses yukarı → D/F#', () => assert.equal(up('C/E', 2), 'D/F#'));
test('plan: Bbmaj7 bir yarım ses aşağı → Amaj7', () => assert.equal(up('Bbmaj7', -1), 'Amaj7'));

test('plan: taşınan bütün akorlar orijinal tona geri döner', () => {
  const cases = [['Am', 1], ['Am', 2], ['G', 2], ['F#m7', 2], ['C/E', 2], ['Bbmaj7', -1], ['Am7', 2], ['Dmaj7', 2]];
  for (const [chord, steps] of cases) {
    assert.equal(up(up(chord, steps), -steps), chord, `${chord} ${steps > 0 ? '+' : ''}${steps} ve geri`);
  }
});

test('plan: Am → Bbm → Bm → Cm ve G → Ab → A → Bb (yarım ses yarım ses)', () => {
  assert.deepEqual([1, 2, 3].map((steps) => up('Am', steps)), ['Bbm', 'Bm', 'Cm']);
  assert.deepEqual([1, 2, 3].map((steps) => up('G', steps)), ['Ab', 'A', 'Bb']);
});

test('plan: bir tam ses örnekleri (Am7, Dmaj7, F#m7, C/E)', () => {
  assert.equal(up('Am7', 2), 'Bm7');
  assert.equal(up('Dmaj7', 2), 'Emaj7');
  assert.equal(up('F#m7', 2), 'G#m7');
  assert.equal(up('C/E', 2), 'D/F#');
});

// --- Akor türleri korunur -------------------------------------------------------

test('akor türleri korunur', () => {
  const cases = {
    C: 'D', Cm: 'Dm', C7: 'D7', Cmaj7: 'Dmaj7', Cm7: 'Dm7', Cm7b5: 'Dm7b5', Cdim: 'Ddim', Cdim7: 'Ddim7',
    'C°': 'D°', 'Cø': 'Dø', Caug: 'Daug', 'C+': 'D+', Csus2: 'Dsus2', Csus4: 'Dsus4', C7sus4: 'D7sus4',
    Cadd9: 'Dadd9', C6: 'D6', 'C6/9': 'D6/9', C9: 'D9', C11: 'D11', C13: 'D13', 'C7#9': 'D7#9', 'C7b9': 'D7b9',
    'Cm(maj7)': 'Dm(maj7)', CmMaj7: 'DmMaj7', CM7: 'DM7', C5: 'D5', 'C-7': 'D-7', 'CΔ7': 'DΔ7', Cmin: 'Dmin',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(up(from, 2), to, from);
});

test('bölü akorlarda kök ve bas birlikte taşınır', () => {
  assert.equal(up('Am/G', 2), 'Bm/A');
  assert.equal(up('D/F#', -2), 'C/E');
  assert.equal(up('G/B', 1), 'Ab/C');
  assert.equal(up('Em7/D', 3), 'Gm7/F');
  assert.equal(up('C/Bb', 2), 'D/C');
});

test('diyez ve bemol yazımı', () => {
  // Kendiliğinden: diyezli nota diyezli, bemollü nota bemollü kalır.
  assert.equal(up('C#m', 2), 'D#m');
  assert.equal(up('Eb', 2), 'F');
  assert.equal(up('Ab', 2), 'Bb');
  assert.equal(up('F#', 1), 'G');
  // İstenirse hep diyez ya da hep bemol.
  assert.equal(up('C', 1, { spelling: 'sharp' }), 'C#');
  assert.equal(up('C', 1, { spelling: 'flat' }), 'Db');
  assert.equal(up('Bb', 0, { spelling: 'sharp' }), 'A#');
  // ♯ ve ♭ işaretleri de anlaşılır.
  assert.equal(up('F♯m', 2), 'G#m');
  assert.equal(up('B♭', -1), 'A');
});

test('12 yarım ses aynı akordur; 0 adımda akor hiç değişmez', () => {
  assert.equal(up('Am', 12), 'Am');
  assert.equal(up('Bbmaj7', -12), 'Bbmaj7');
  assert.equal(up('A#m', 0), 'A#m');
});

test('her adımda yukarı ve aşağı taşıma aynı seslere döner', () => {
  for (const chord of ['C', 'F#m7', 'Bbmaj7', 'C/E', 'Ebdim', 'G#sus4']) {
    const original = parseChord(chord);
    for (let steps = -11; steps <= 11; steps += 1) {
      const moved = parseChord(up(chord, steps));
      assert.equal(moved.rootPitch, (original.rootPitch + steps + 120) % 12, `${chord} ${steps}`);
      assert.equal(moved.suffix, original.suffix);
      const back = parseChord(up(up(chord, steps), -steps));
      assert.equal(back.rootPitch, original.rootPitch);
    }
  }
});

// --- Tanınmayan akorlar -----------------------------------------------------------

test('tanınmayan akor bozulmadan geri verilir', () => {
  for (const text of ['Hm', 'Xyz', 'La', 'Am7x', 'Ama', 'Bu', 'Do', '', 'C/Hm']) {
    const result = transposeChord(text, 2);
    assert.equal(result.ok, false, text);
    assert.equal(result.text, text);
  }
});

test('sözcükler akor sanılmaz, akorlar tanınır', () => {
  for (const word of ['Bu', 'Ama', 'Gel', 'Ah', 'Dem', 'Can', 'Ben']) assert.equal(isChord(word), false, word);
  for (const chord of ['A', 'Am', 'Dm', 'Gm', 'F#m7', 'Bbmaj7', 'C/E', 'Dsus4', 'E7']) assert.equal(isChord(chord), true, chord);
});

test('küçük harfli kök yalnızca istenirse kabul edilir', () => {
  assert.equal(isChord('am'), false);
  assert.equal(up('am', 2, { lenient: true }), 'Bm');
});

test('akor olmayan işaretler ayırt edilir', () => {
  for (const mark of ['N.C.', 'NC', 'x2', '(x2)', '2x', '|', '||', '%', '-', '/']) assert.equal(isAnnotation(mark), true, mark);
  for (const text of ['Am', 'Bu', 'Hm']) assert.equal(isAnnotation(text), false, text);
});

// --- Tonlar ---------------------------------------------------------------------

test('ton taşıma ve ton adları', () => {
  assert.equal(transposeKey('Am', 1), 'Bbm');
  assert.equal(transposeKey('G', 1), 'Ab');
  assert.equal(transposeKey('G', -1), 'F#');
  assert.equal(transposeKey('E', 1), 'F');
  assert.equal(transposeKey('C#m', 0), 'C#m');
  assert.equal(transposeKey('am', 3), 'Cm');
  assert.equal(transposeKey('Hicaz', 2), null);
  assert.deepEqual(parseKey('F#m'), { pitch: 6, minor: true });
  assert.equal(parseKey('Am7'), null);
});

test('tona göre diyez/bemol seçimi', () => {
  assert.equal(spellingForKey('G'), 'sharp');
  assert.equal(spellingForKey('Em'), 'sharp');
  assert.equal(spellingForKey('F'), 'flat');
  assert.equal(spellingForKey('Dm'), 'flat');
  assert.equal(spellingForKey('C'), 'auto');
  assert.equal(spellingForKey('Am'), 'auto');
  assert.equal(spellingForKey(''), 'auto');
});

test('istenen tona kaç yarım ses', () => {
  assert.equal(stepsBetweenKeys('Am', 'Cm'), 3);
  assert.equal(stepsBetweenKeys('Am', 'Gm'), -2);
  assert.equal(stepsBetweenKeys('G', 'Db'), 6);
  assert.equal(stepsBetweenKeys('C', 'B'), -1);
  assert.equal(stepsBetweenKeys('C', 'Hicaz'), null);
  assert.equal(normalizeSteps(14), 2);
  assert.equal(normalizeSteps(-7), 5);
  assert.deepEqual(keysLike('Am').slice(0, 3), ['Cm', 'C#m', 'Dm']);
  assert.equal(keysLike('G').length, 12);
});
