import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allKeys, fifthsOf, guessMode, intervalBetween, keyLabel, measureProblems, moveTarget, parseKeyText, parseNotes,
  parseScoreImport, parseTime, pitchLabel, serializeNotes, signatureAlter, transposeScore,
  transposeTargets, withAccidentals,
} from '../js/music/notation.js';

const LA_MINOR = { step: 5, alter: 0, mode: 'minor' };
const names = (measures) => measures.flat().map((n) => (n.rest ? 'sus' : `${pitchLabel(n.step, n.alter)}${n.octave}`));
const shownNames = (measures, fifths) =>
  withAccidentals(measures, fifths).flat().map((n) => `${n.step}${n.shown === null ? '' : `(${n.shown})`}`);

test('donanımlar: la minör donanımsız, mi minör 1♯, re minör 1♭, si minör 2♯', () => {
  assert.equal(fifthsOf(LA_MINOR), 0);
  assert.equal(fifthsOf(parseKeyText('mi minör')), 1);
  assert.equal(fifthsOf(parseKeyText('re minör')), -1);
  assert.equal(fifthsOf(parseKeyText('si minör')), 2);
  assert.equal(fifthsOf(parseKeyText('Do majör')), 0);
  assert.equal(fifthsOf(parseKeyText('mi bemol majör')), -3);
  assert.equal(fifthsOf(parseKeyText('fa diyez minör')), 3);
  assert.equal(fifthsOf(parseKeyText('F#m')), 3);
  assert.equal(fifthsOf(parseKeyText('Bb')), -2);
});

test('donanımın işaretleri doğru sırada', () => {
  // Sol majör: fa diyez
  assert.equal(signatureAlter(1, 3), 1);
  assert.equal(signatureAlter(1, 0), 0);
  // Fa majör: si bemol
  assert.equal(signatureAlter(-1, 6), -1);
  assert.equal(signatureAlter(-1, 2), 0);
});

test('kullanıcının örneği: la minör "la si do re mi fa sol# la" — donanımda değişiklik yok', () => {
  const { measures, errors } = parseNotes('la4:4 si4 do5 re5 | mi5 fa5 sol#5 la5 |', LA_MINOR, parseTime('4/4'));
  assert.deepEqual(errors, []);
  assert.deepEqual(names(measures), ['la4', 'si4', 'do5', 're5', 'mi5', 'fa5', 'sol♯5', 'la5']);
  assert.equal(fifthsOf(LA_MINOR), 0);
  // Yalnızca sol diyezin önünde işaret var
  assert.deepEqual(shownNames(measures, 0), ['5', '6', '0', '1', '2', '3', '4(1)', '5']);
});

test('örneği si minöre taşıma: donanım 2♯ olur, sol diyez la diyez olur', () => {
  const { measures } = parseNotes('la4:4 si4 do5 re5 | mi5 fa5 sol#5 la5 |', LA_MINOR, parseTime('4/4'));
  const target = parseKeyText('si minör');
  const out = transposeScore(measures, LA_MINOR, target);
  assert.equal(out.fifths, 2);
  assert.equal(keyLabel(out.key), 'Si minör');
  assert.deepEqual(names(out.measures), ['si4', 'do♯5', 're5', 'mi5', 'fa♯5', 'sol5', 'la♯5', 'si5']);
  // Donanım fa♯ ve do♯'yi zaten veriyor: yalnızca la♯ işaretli
  assert.deepEqual(shownNames(out.measures, out.fifths), ['6', '0', '1', '2', '3', '4', '5(1)', '6']);
});

test('örneği sol minöre (aşağı) ve re minöre taşıma', () => {
  const { measures } = parseNotes('la4:4 si4 do5 re5 | mi5 fa5 sol#5 la5 |', LA_MINOR, parseTime('4/4'));
  const g = transposeScore(measures, LA_MINOR, parseKeyText('sol minör'));
  assert.equal(g.fifths, -2);
  assert.deepEqual(names(g.measures), ['sol4', 'la4', 'si♭4', 'do5', 're5', 'mi♭5', 'fa♯5', 'sol5']);
  assert.deepEqual(shownNames(g.measures, g.fifths), ['4', '5', '6', '0', '1', '2', '3(1)', '4']);
  const d = transposeScore(measures, LA_MINOR, parseKeyText('re minör'));
  assert.equal(d.fifths, -1);
  assert.deepEqual(names(d.measures), ['re5', 'mi5', 'fa5', 'sol5', 'la5', 'si♭5', 'do♯6', 're6']);
});

test('kâğıttaki kurallar: donanım uygulanır, ölçüdeki işaret ölçü sonuna kadar sürer', () => {
  const G = parseKeyText('sol majör');
  const { measures } = parseNotes('fa5:4 fan5 fa5 fa5 | fa5:1 |', G, parseTime('4/4'));
  assert.deepEqual(names(measures), ['fa♯5', 'fa5', 'fa5', 'fa5', 'fa♯5']);
  // Geri yazınca da aynı kural: ikinci ölçüde işaret gerekmez
  assert.equal(serializeNotes(measures, G), 'fa5:4 fan5 fa5 fa5 | fa5:1 |');
});

test('süreler, noktalar, suslar ve ölçü denetimi', () => {
  const { measures, errors } = parseNotes('do5:4. re5:8 mi5:2 | sus:2 sol5:8 la5 si5:4 | do6:1 |', parseKeyText('Do majör'), parseTime('4/4'));
  assert.deepEqual(errors, []);
  assert.equal(measures.length, 3);
  assert.deepEqual(measures[0].map((n) => [n.dur, n.dots]), [[4, 1], [8, 0], [2, 0]]);
  assert.deepEqual(measures[1][0], { rest: true, dur: 2, dots: 0 });
  assert.deepEqual(measureProblems(measures, parseTime('4/4')), []);
  const bad = parseNotes('do5:4 re5:4 | mi5:4 | fa5:1 |', parseKeyText('Do majör'), parseTime('4/4')).measures;
  assert.deepEqual(measureProblems(bad, parseTime('4/4')).map((p) => p.index), [1]);
});

test('ölçü çizgisi yoksa ölçü işaretine göre bölünür; oktav yazılmazsa en yakın oktav', () => {
  const { measures } = parseNotes('la4:8 si do re mi fa sol# la', LA_MINOR, parseTime('2/4'));
  assert.equal(measures.length, 2);
  assert.deepEqual(names(measures), ['la4', 'si4', 'do5', 're5', 'mi5', 'fa5', 'sol♯5', 'la5']);
});

test('anlaşılmayan yazı hata olarak bildirilir', () => {
  const { errors } = parseNotes('la4 xyz si4', LA_MINOR, parseTime('4/4'));
  assert.deepEqual(errors.map((e) => e.token), ['xyz']);
});

test('aralık: en yakın yön seçilir, oktav eklenebilir', () => {
  assert.deepEqual(intervalBetween(LA_MINOR, parseKeyText('si minör')), { steps: 1, semis: 2 });
  assert.deepEqual(intervalBetween(LA_MINOR, parseKeyText('sol minör')), { steps: -1, semis: -2 });
  assert.deepEqual(intervalBetween(LA_MINOR, parseKeyText('mi minör')), { steps: -3, semis: -5 });
  assert.deepEqual(intervalBetween(LA_MINOR, parseKeyText('la minör'), 1), { steps: 7, semis: 12 });
});

test('12 hedef ton, her biri doğru donanımla; bütün tonlarda gidiş-dönüş', () => {
  const targets = transposeTargets('minor');
  assert.equal(targets.length, 12);
  const { measures } = parseNotes('la4:4 si4 do5 re5 | mi5 fa5 sol#5 la5 |', LA_MINOR, parseTime('4/4'));
  for (const target of targets) {
    const there = transposeScore(measures, LA_MINOR, target.key);
    assert.equal(there.fifths, target.fifths, keyLabel(target.key));
    const back = transposeScore(there.measures, there.key, LA_MINOR);
    // yükseklikler (midi) aynı kalmalı; dönüşte oktav en yakın yöne göre ayarlanabilir
    const pitch = (n) => 12 * (n.octave + 1) + [0, 2, 4, 5, 7, 9, 11][n.step] + n.alter;
    const diff = pitch(back.measures[0][0]) - pitch(measures[0][0]);
    assert.ok(diff % 12 === 0, keyLabel(target.key));
    assert.deepEqual(names(back.measures).map((x) => x.replace(/\d+$/, '')), names(measures).map((x) => x.replace(/\d+$/, '')));
  }
  assert.equal(allKeys('major').length, 15);
});

test('kod ↔ notalar: geri yazılan kod aynı notaları verir', () => {
  const code = 'mi5:8. re#5:16 mi5:8 si4:8 re5:8 dob5:8 | la4:4 sus:8 do4:8 mi4:8 la4:8 |';
  const key = parseKeyText('la minör');
  const first = parseNotes(code, key, parseTime('3/4')).measures;
  const again = parseNotes(serializeNotes(first, key), key, parseTime('3/4')).measures;
  assert.deepEqual(again, first);
});

test('aktarma metni', () => {
  const data = parseScoreImport(`Repertuvarım nota
Ad: Gamın sesleri
Besteci: Deneme
Ton: la minör
Ölçü: 4/4
Notalar:
la4:4 si4 do5 re5 |
mi5 fa5 sol#5 la5 |`);
  assert.equal(data.title, 'Gamın sesleri');
  assert.deepEqual(data.key, LA_MINOR);
  assert.equal(data.time, '4/4');
  assert.equal(data.code, 'la4:4 si4 do5 re5 |\nmi5 fa5 sol#5 la5 |');
  assert.equal(parseScoreImport('başka bir metin'), null);
});

test('çift çizgiyle bölünmüş ölçü hata sayılmaz; gerçekten eksik ölçü sayılır', () => {
  const key = parseKeyText('Fa majör');
  // "fa2." (3 vuruş) + "do8 do8" (1 vuruş) = bölünmüş tek ölçü; 2. ölçüde bir nota eksik
  const { measures } = parseNotes('do4:8 do4 | do4:4 fa4:8 fa4 fa4:4 fa4:8 | sol4:4 la4 si4 la4 | fa4:2. | do4:8 do4 | do4:4 fa4:8 fa4 fa4:4 mi4:8 fa4 |', key, parseTime('4/4'));
  assert.deepEqual(measureProblems(measures, parseTime('4/4')).map((p) => p.index), [1]);
});

test('bütün tonların donanımı kaynak tabloyla aynı (30 ton)', () => {
  const MAJOR = { 0: 'Do', 1: 'Sol', 2: 'Re', 3: 'La', 4: 'Mi', 5: 'Si', 6: 'Fa♯', 7: 'Do♯', '-1': 'Fa', '-2': 'Si♭', '-3': 'Mi♭', '-4': 'La♭', '-5': 'Re♭', '-6': 'Sol♭', '-7': 'Do♭' };
  const MINOR = { 0: 'La', 1: 'Mi', 2: 'Si', 3: 'Fa♯', 4: 'Do♯', 5: 'Sol♯', 6: 'Re♯', 7: 'La♯', '-1': 'Re', '-2': 'Sol', '-3': 'Do', '-4': 'Fa', '-5': 'Si♭', '-6': 'Mi♭', '-7': 'La♭' };
  for (const [mode, table] of [['major', MAJOR], ['minor', MINOR]]) {
    for (const item of allKeys(mode)) assert.equal(keyLabel(item.key).split(' ')[0], table[item.fifths], `${mode} ${item.fifths}`);
  }
  // diyez sırası fa do sol re la mi si, bemol sırası si mi la re sol do fa
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((f) => [0, 1, 2, 3, 4, 5, 6].filter((s) => signatureAlter(f, s) === 1).length), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(signatureAlter(2, 0), 1); // Re majör: do♯
  assert.equal(signatureAlter(0, 0), 0); // La minör: do♯ yok
  assert.equal(signatureAlter(-3, 5), -1); // Do minör: la♭
});

test('aynı donanımlı tonlar arasında notalar yer değiştirmez (Do majör → La minör: do♯ çıkmaz)', () => {
  const from = parseKeyText('do majör');
  const to = parseKeyText('la minör');
  const { measures } = parseNotes('la4:4 si4 do5 re5 | mi5 fa5 sol#5 la5 |', from, parseTime('4/4'));
  const target = moveTarget(from, to);
  assert.deepEqual(target, from);
  const out = transposeScore(measures, from, target);
  assert.equal(serializeNotes(out.measures, to), 'la4:4 si4 do5 re5 | mi5 fa5 sol#5 la5 |');
  // farklı donanım: Do majör → Si minör (2♯) notalar Re majöre göre taşınır
  const si = transposeScore(measures, from, moveTarget(from, parseKeyText('si minör')));
  assert.equal(serializeNotes(si.measures, parseKeyText('si minör')), 'si4:4 do5 re5 mi5 | fa5 sol5 la#5 si5 |');
});

test('okunan beste: tür yazılmamışsa minör olduğu notalardan anlaşılır', () => {
  const C = parseKeyText('do majör');
  const parse = (code) => parseNotes(code, C, parseTime('4/4')).measures;
  assert.equal(keyLabel(guessMode(parse('do4 re4 mi4 fa4 | sol4 la4 si4 do5 |'), C)), 'Do majör');
  assert.equal(keyLabel(guessMode(parse('la4 si4 do5 re5 | mi5 fa5 sol#5 la5 |'), C)), 'La minör');
  assert.equal(keyLabel(guessMode(parse('mi4 sol#4 si4 sol#4 | la4:1 |'), C)), 'La minör');
  assert.equal(keyLabel(guessMode(parse('la4 si4 | do5:2 |'), C)), 'Do majör');
});
