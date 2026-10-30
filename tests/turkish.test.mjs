// Türkçe harfler (İ, ı …) ve Türk müziği makamları için testler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, foldLetters, foldForSearch } from '../js/lib/text.js';
import { normalizeKeyName, normalizeSong, validateName, validateSongForm, normalizeScore } from '../js/data/model.js';
import { parseImport, convertChordSheet } from '../js/music/song-text.js';
import {
  allKeys, keyLabel, moveTarget, parseKeyText, parseNotes, parseTime, serializeNotes, signatureLabel,
  signatureOf, signatureMarks, transposeScore, transposeTargets, withAccidentals, parseScoreImport, isKnownKey,
} from '../js/music/notation.js';

const label = (key) => signatureLabel(signatureOf(key));

test('cleanText: bozuk noktalı i düzelir, normal metin değişmez', () => {
  assert.equal(cleanText('İstanbul ışık'), 'İstanbul ışık');
  assert.equal(cleanText('i̇stanbul'), 'istanbul'); // başka dilde küçültülmüş İ
  assert.equal(cleanText('İzmir'), 'İzmir'); // ayrık yazılmış İ
  assert.equal(cleanText('İzmir').length, 5);
  assert.equal(cleanText(null), '');
});

test('foldLetters: büyük/küçük ve noktalı/noktasız i farkı kalkar', () => {
  for (const text of ['SI', 'Sİ', 'sı', 'si', 'Si']) assert.equal(foldLetters(text), 'si');
  assert.equal(foldLetters('MİNÖR'), 'minör');
  assert.equal(foldLetters('MINÖR'), 'minör');
  assert.equal(foldLetters('ŞARKI'), 'şarki');
});

test('arama İ/ı ile çalışır', () => {
  assert.equal(foldForSearch('İSTANBUL'), foldForSearch('istanbul'));
  assert.equal(foldForSearch('IŞIK'), foldForSearch('ışık'));
  assert.equal(foldForSearch('i̇stanbul'), 'istanbul');
});

test('şarkı kaydı Türkçe harfleri korur', () => {
  const song = normalizeSong({ title: 'İzmir’in Kızları', artist: 'ILIK', content: '[Am]Işıklar i̇çinde' });
  assert.equal(song.title, 'İzmir’in Kızları');
  assert.equal(song.artist, 'ILIK');
  assert.equal(song.content, '[Am]Işıklar içinde');
  const form = validateSongForm({ title: 'Iğdır', content: '[C]İnce ince' });
  assert.equal(form.valid, true);
  assert.equal(form.value.content, '[C]İnce ince');
});

test('kategori adı: İlahi ile İLAHİ aynı sayılır, Işık ile İşik ayrı', () => {
  assert.equal(validateName('İLAHİ', [{ name: 'İlahi' }]).ok, false);
  assert.equal(validateName('ılık', [{ name: 'ILIK' }]).ok, false);
});

test('şarkı tonu Türkçe yazılabilir', () => {
  assert.equal(normalizeKeyName('La minör'), 'Am');
  assert.equal(normalizeKeyName('LA MİNÖR'), 'Am');
  assert.equal(normalizeKeyName('LA MINOR'), 'Am');
  assert.equal(normalizeKeyName('Lam'), 'Am');
  assert.equal(normalizeKeyName('Sİ'), 'B');
  assert.equal(normalizeKeyName('SI'), 'B');
  assert.equal(normalizeKeyName('sı bemol majör'), 'Bb');
  assert.equal(normalizeKeyName('Fa diyez minör'), 'F#m');
  assert.equal(normalizeKeyName('Mİm'), 'Em');
  assert.equal(normalizeKeyName('Do'), 'C');
  assert.equal(normalizeKeyName('Am'), 'Am');
  assert.equal(normalizeKeyName('Bb'), 'Bb');
  assert.equal(normalizeKeyName('Hello'), null);
  assert.equal(normalizeKeyName('La Hicaz'), null); // şarkı tonu akor tonudur
});

test('aktarma başlıkları büyük harfle de tanınır', () => {
  const out = parseImport('REPERTUVARIM AKTARIM\nŞARKI: Işıklar\nSANATÇI: İlhan\nTON: Am\n\nAm\nIşıl ışıl');
  assert.equal(out.title, 'Işıklar');
  assert.equal(out.artist, 'İlhan');
  assert.equal(out.content, '[Am]Işıl ışıl');
});

test('akor hizası ayrık noktalı İ ile kaymaz', () => {
  const out = convertChordSheet('    Am\nİnce ince').text;
  assert.equal(out, 'İnce[Am] ince');
});

test('nota kodu: SI, Sİ, sı, si hepsi si', () => {
  const key = { step: 5, alter: 0, mode: 'minor' };
  const { measures, errors } = parseNotes('LA4:4 SI4 Sİ4 sı4 | DO5:1 |', key, parseTime('4/4'));
  assert.deepEqual(errors, []);
  assert.deepEqual(measures[0].map((n) => n.step), [5, 6, 6, 6]);
});

test('ton yazısı: Türkçe büyük harf ve makamlar', () => {
  assert.deepEqual(parseKeyText('SI MİNÖR'), { step: 6, alter: 0, mode: 'minor' });
  assert.deepEqual(parseKeyText('LA MINOR'), { step: 5, alter: 0, mode: 'minor' });
  assert.deepEqual(parseKeyText('La Hicaz'), { step: 5, alter: 0, mode: 'hicaz' });
  assert.deepEqual(parseKeyText('SOL RAST'), { step: 4, alter: 0, mode: 'rast' });
  assert.deepEqual(parseKeyText('do nihavent'), { step: 0, alter: 0, mode: 'nihavend' });
  assert.equal(parseKeyText('la kürdi'), null);
});

// Kullanıcının verdiği tablo (12 sesli düzende).
const MAKAM_TABLE = [
  ['la', 'hicaz', 'si♭ do♯'],
  ['mi', 'hicaz', 'sol♯'],
  ['re', 'hicaz', 'mi♭ fa♯'],
  ['sol', 'hicaz', 'la♭'],
  ['sol', 'rast', '1♯'],
  ['do', 'rast', 'donanımsız'],
  ['re', 'rast', '2♯'],
  ['sol', 'nihavend', '2♭'],
  ['la', 'nihavend', 'donanımsız'],
  ['re', 'nihavend', '1♭'],
  ['do', 'nihavend', '3♭'],
];
const STEP = { do: 0, re: 1, mi: 2, fa: 3, sol: 4, la: 5, si: 6 };

test('makam donanımları tabloya uyar', () => {
  for (const [tonic, mode, expected] of MAKAM_TABLE) {
    const key = { step: STEP[tonic], alter: 0, mode };
    assert.equal(label(key), expected, `${tonic} ${mode}`);
    assert.ok(isKnownKey(key));
  }
  // Rast: Sol Rast fa♯; Nihavend: Sol Nihavend si♭ mi♭, Do Nihavend mi♭ la♭ si♭
  assert.deepEqual(signatureMarks(signatureOf({ step: 4, alter: 0, mode: 'nihavend' })), [{ step: 6, alter: -1 }, { step: 2, alter: -1 }]);
  assert.deepEqual(signatureMarks(signatureOf({ step: 0, alter: 0, mode: 'nihavend' })).map((m) => m.step), [6, 2, 5]);
  assert.equal(keyLabel({ step: 5, alter: 0, mode: 'hicaz' }), 'La Hicaz');
  assert.equal(keyLabel({ step: 6, alter: -1, mode: 'hicaz' }), 'Si♭ Hicaz');
});

test('Hicaz dizisi: 2. küçük, 3. büyük derece (artık ikili)', () => {
  for (const item of allKeys('hicaz')) {
    const sig = item.signature;
    assert.ok(Array.isArray(sig), keyLabel(item.key));
    const pcs = [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const step = (item.key.step + d) % 7;
      const alter = sig.find((m) => m.step === step)?.alter ?? 0;
      return ((([0, 2, 4, 5, 7, 9, 11][step] + alter) - ([0, 2, 4, 5, 7, 9, 11][item.key.step] + item.key.alter)) % 12 + 12) % 12;
    });
    assert.deepEqual(pcs.slice(0, 5), [0, 1, 4, 5, 7], keyLabel(item.key));
    assert.ok(pcs[5] === 8 || pcs[5] === 9, keyLabel(item.key));
    assert.equal(pcs[6], 10, keyLabel(item.key));
  }
  assert.equal(transposeTargets('hicaz').length, 12);
  assert.equal(transposeTargets('rast').length, 12);
  assert.equal(transposeTargets('nihavend').length, 12);
});

test('La Hicaz dizisi donanımla işaretsiz yazılır', () => {
  const key = { step: 5, alter: 0, mode: 'hicaz' };
  const { measures } = parseNotes('la4:8 si4 do5 re5 mi5 fa5 sol5 la5 |', key, parseTime('4/4'));
  // si = si♭, do = do♯ (donanım)
  assert.deepEqual(measures[0].map((n) => n.alter), [0, -1, 1, 0, 0, 0, 0, 0]);
  assert.ok(withAccidentals(measures, signatureOf(key)).flat().every((n) => n.shown === null));
  assert.equal(serializeNotes(measures, key), 'la4:8 si4 do5 re5 mi5 fa5 sol5 la5 |');
});

test('La Hicaz → Re Hicaz transpoze: tonik re, donanım mi♭ fa♯', () => {
  const key = { step: 5, alter: 0, mode: 'hicaz' };
  const { measures } = parseNotes('la4:8 si4 do5 re5 mi5 fa5 sol5 la5 |', key, parseTime('4/4'));
  const target = transposeTargets('hicaz').find((item) => item.key.step === 1 && item.key.alter === 0).key;
  const out = transposeScore(measures, key, target);
  assert.equal(keyLabel(out.key), 'Re Hicaz');
  assert.equal(signatureLabel(out.signature), 'mi♭ fa♯');
  // La Hicaz'daki fa (küçük altılı) Re Hicaz'da si♭ olur; Re Hicaz donanımında si doğal olduğundan işaretle yazılır.
  assert.equal(serializeNotes(out.measures, out.key), 're5:8 mi5 fa5 sol5 la5 sib5 do6 re6 |');
});

test('makama geçişte notalar yerinde kalır', () => {
  const laMinor = { step: 5, alter: 0, mode: 'minor' };
  const laHicaz = { step: 5, alter: 0, mode: 'hicaz' };
  assert.deepEqual(moveTarget(laMinor, laHicaz), laMinor);
  assert.deepEqual(moveTarget(laHicaz, laMinor), laHicaz);
  // Aynı makamda tonik toniğe
  const reHicaz = { step: 1, alter: 0, mode: 'hicaz' };
  assert.deepEqual(moveTarget(laHicaz, reHicaz), reHicaz);
  // Do majör → La minör eskisi gibi (aynı donanım)
  assert.deepEqual(moveTarget({ step: 0, alter: 0, mode: 'major' }, laMinor), { step: 0, alter: 0, mode: 'major' });
  // La minör'de yazılmış si (doğal) La Hicaz'a geçince "sin" (natürel) olarak kalır
  const { measures } = parseNotes('la4:4 si4 do5 re5 |', laMinor, parseTime('4/4'));
  assert.equal(serializeNotes(measures, laHicaz), 'la4:4 sin4 don5 re5 |');
});

test('nota kaydı makam tonunu korur; aktarma metninde makam okunur', () => {
  assert.equal(normalizeScore({ key: { step: 5, alter: 0, mode: 'hicaz' } }).key.mode, 'hicaz');
  assert.equal(normalizeScore({ key: { step: 5, alter: 0, mode: 'xyz' } }).key.mode, 'major');
  const data = parseScoreImport('REPERTUVARIM NOTA\nAD: Hicaz Peşrev\nMAKAM: La Hicaz\nÖLÇÜ: 4/4\nNOTALAR:\nla4:4 si4 do5 re5 |');
  assert.deepEqual(data.key, { step: 5, alter: 0, mode: 'hicaz' });
  assert.equal(data.title, 'Hicaz Peşrev');
});
