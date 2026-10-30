import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, parseAbc, parseAbcKey, splitLength } from '../js/music/abc.js';
import { keyLabel, measureProblems, parseNotes, parseTime, pitchLabel, serializeNotes, transposeScore, parseKeyText, fifthsOf } from '../js/music/notation.js';

const names = (measures) => measures.flat().map((n) => (n.rest ? 'sus' : `${pitchLabel(n.step, n.alter)}${n.octave}`));

test('ton satırı: majör, minör, modlar, fa anahtarı', () => {
  assert.equal(keyLabel(parseAbcKey('F').key), 'Fa majör');
  assert.equal(keyLabel(parseAbcKey('Am').key), 'La minör');
  assert.equal(keyLabel(parseAbcKey('Bbmin').key), 'Si♭ minör');
  assert.equal(parseAbcKey('F#m').fifths, 3);
  assert.equal(parseAbcKey('Ddor').fifths, 0); // re doryen: donanımsız
  assert.equal(parseAbcKey('Amix').fifths, 2);
  assert.equal(parseAbcKey('C clef=bass').clef, 'bass');
  assert.equal(parseAbcKey('none').fifths, 0);
});

test('süre parçalama', () => {
  assert.deepEqual(splitLength(1 / 4), [{ dur: 4, dots: 0 }]);
  assert.deepEqual(splitLength(3 / 8), [{ dur: 4, dots: 1 }]);
  assert.deepEqual(splitLength(7 / 8), [{ dur: 2, dots: 2 }]);
  assert.deepEqual(splitLength(5 / 8), [{ dur: 2, dots: 0 }, { dur: 8, dots: 0 }]);
});

test('okuyucunun gerçek çıktısı (Twelve Days, Fa majör)', () => {
  const abc = `X:1
T:text
L:1/8
M:4/4
I:linebreak $
K:F
V:1 treble nm="text"
V:1
 C C | C2 F F F2 E F | G A B G A4 | c2 G A B2 A B | %4
w: text text|text text text text text|text text text text text|
 c4 (d =B3) | c8 |[M:3/4] (cB) A G F2 |$ B2 D2 F2 |[M:4/4] (GF) E D C2 A B | %9`;
  const r = parseAbc(abc);
  assert.equal(cleanTitle(r.title), '');
  assert.equal(keyLabel(r.key), 'Fa majör');
  assert.equal(r.time, '4/4');
  assert.equal(r.measures.length, 9);
  assert.deepEqual(names([r.measures[2]]), ['sol4', 'la4', 'si♭4', 'sol4', 'la4']); // si, donanımdan bemol
  assert.deepEqual(names([r.measures[4]]), ['do5', 're5', 'si4']); // =B natürel
  assert.equal(r.measures[6][0].meter, '3/4');
  assert.equal(r.measures[8][0].meter, '4/4');
  assert.deepEqual(measureProblems(r.measures, parseTime(r.time)), []);
  // koda yazıp geri okuyunca aynı
  const code = serializeNotes(r.measures, r.key);
  assert.deepEqual(parseNotes(code, r.key, parseTime(r.time)).measures, r.measures);
});

test('değişim işareti ölçü sonuna kadar geçerli; sonraki ölçüde donanıma döner', () => {
  const r = parseAbc('L:1/4\nM:3/4\nK:G\n ^c c F | c F =F |');
  assert.deepEqual(names(r.measures), ['do♯5', 'do♯5', 'fa♯4', 'do5', 'fa♯4', 'fa4']);
});

test('oktavlar, suslar, akor (ezgi = en üst nota), üçleme, çok ölçülü sus', () => {
  const r = parseAbc("L:1/8\nM:2/4\nK:C\n C, c' z [CEG] | (3abc d2 | Z2 |");
  assert.deepEqual(names([r.measures[0]]), ['do3', 'do6', 'sus', 'sol4']);
  assert.equal(r.measures[0][3].dur, 8);
  assert.deepEqual(r.measures[1].map((n) => n.tup ?? 0), [3, 3, 3, 0]);
  assert.deepEqual(measureProblems(r.measures, parseTime('2/4')), []);
  assert.equal(r.measures.length, 4); // Z2: iki ölçü sus
  assert.ok(r.warnings.includes('chords'));
});

test('birden fazla ses: yalnızca ilk ses; sözler ve süslemeler atlanır', () => {
  const r = parseAbc('L:1/4\nM:2/4\nK:Dm\nV:1 treble\n"Dm" !p! d e |\nw: la la\nV:2 bass\n D, A, |\nV:1\n {g}f2 |');
  assert.deepEqual(names(r.measures), ['re5', 'mi5', 'fa5']);
});

test('fa anahtarındaki ilk ses', () => {
  const r = parseAbc('L:1/4\nM:4/4\nK:C\nV:1 bass\n C, D, E, F, |');
  assert.equal(r.clef, 'bass');
  assert.deepEqual(names(r.measures), ['do3', 're3', 'mi3', 'fa3']);
});

test('okunan beste donanımıyla transpoze olur', () => {
  const r = parseAbc('L:1/4\nM:4/4\nK:Am\n A B c d | e f ^g a |');
  const out = transposeScore(r.measures, r.key, parseKeyText('si minör'));
  assert.equal(out.fifths, 2);
  assert.deepEqual(names(out.measures), ['si4', 'do♯5', 're5', 'mi5', 'fa♯5', 'sol5', 'la♯5', 'si5']);
  assert.equal(fifthsOf(r.key), 0);
});
