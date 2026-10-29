// Şarkı ve kategori veri biçiminin testleri.
// Çalıştırmak için (Node.js kurulu bir bilgisayarda, proje klasöründe): node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSong,
  normalizeCategory,
  normalizeKeyName,
  findBracketProblemLine,
  validateSongForm,
  emptySongForm,
  songToForm,
  sameForm,
  createId,
} from '../js/data/model.js';

test('eksik alanlar güvenli varsayılanlarla dolar', () => {
  const song = normalizeSong({ id: 7, title: '  Liman ', createdAt: 1000 });
  assert.deepEqual(song, {
    id: '7',
    title: 'Liman',
    artist: '',
    key: '',
    categoryIds: [],
    capo: 0,
    bpm: null,
    notes: '',
    favorite: false,
    content: '',
    isSample: false,
    createdAt: 1000,
    updatedAt: 1000,
  });
});

test('hatalı değerler düzeltilir', () => {
  const song = normalizeSong({
    id: 'x',
    categoryIds: ['pop', 'pop', '', null, 'rock'],
    capo: -2,
    bpm: 'hızlı',
    favorite: 'evet',
    isSample: 1,
    createdAt: 'dün',
  });
  assert.deepEqual(song.categoryIds, ['pop', 'rock']);
  assert.equal(song.capo, 0);
  assert.equal(song.bpm, null);
  assert.equal(song.favorite, false);
  assert.equal(song.isSample, false);
  assert.equal(typeof song.createdAt, 'number');
  assert.equal(song.updatedAt, song.createdAt);
});

test('doğru değerler olduğu gibi kalır', () => {
  const raw = {
    id: 's1', title: 'Ayrılık Rüzgârı', artist: 'Selim Kaya', key: 'Am', categoryIds: ['arabesk'],
    capo: 2, bpm: 76, notes: 'Not', favorite: true, content: '[Am]Söz', isSample: true,
    createdAt: 10, updatedAt: 20,
  };
  assert.deepEqual(normalizeSong(raw), raw);
});

test('ton yazımı düzenlenir', () => {
  assert.equal(normalizeKeyName('am'), 'Am');
  assert.equal(normalizeKeyName(' F#m '), 'F#m');
  assert.equal(normalizeKeyName('f♯m'), 'F#m');
  assert.equal(normalizeKeyName('Bb'), 'Bb');
  assert.equal(normalizeKeyName('b♭'), 'Bb');
  assert.equal(normalizeKeyName('Cmin'), 'Cm');
  assert.equal(normalizeKeyName('E-'), 'Em');
  assert.equal(normalizeKeyName(''), '');
  assert.equal(normalizeKeyName('Hicaz'), null);
  assert.equal(normalizeKeyName('H'), null);
  assert.equal(normalizeKeyName('Am7'), null);
});

test('akor parantezi sorunları satır numarasıyla bulunur', () => {
  assert.equal(findBracketProblemLine('[Am]Bu gece\n[F]Sensiz'), 0);
  assert.equal(findBracketProblemLine('[Am]Bu gece\n[F Sensiz'), 2);
  assert.equal(findBracketProblemLine('Am]Bu gece'), 1);
  assert.equal(findBracketProblemLine('[[Am]]'), 1);
  assert.equal(findBracketProblemLine('Akorsuz söz'), 0);
});

test('zorunlu alanlar boşsa anlaşılır mesaj verilir', () => {
  const { valid, errors } = validateSongForm(emptySongForm());
  assert.equal(valid, false);
  assert.equal(errors.title, 'Şarkı adını yazın.');
  assert.equal(errors.content, 'Sözleri ve akorları yazın.');
});

test('hatalı ton, tempo ve parantez yakalanır', () => {
  const { errors } = validateSongForm({ ...emptySongForm(), title: 'X', content: 'a\n[Am b', key: 'Hicaz', bpm: '500' });
  assert.match(errors.content, /^2\. satırda/);
  assert.ok(errors.key);
  assert.ok(errors.bpm);
});

test('geçerli form düzenlenmiş değerleri verir; sözlerdeki boşluklar korunur', () => {
  const content = '[Am]Bu gece   yine aklımdasın\r\n\r\n[F]Sensiz  geçen günler  ';
  const { valid, value } = validateSongForm({
    title: '  Yeni Şarkı ', artist: ' Ben ', key: 'am', content, categoryIds: ['pop', 'pop', 'rock'],
    capo: '3', bpm: '92', notes: 'not', favorite: true,
  });
  assert.equal(valid, true);
  assert.deepEqual(value, {
    title: 'Yeni Şarkı', artist: 'Ben', key: 'Am',
    content: '[Am]Bu gece   yine aklımdasın\n\n[F]Sensiz  geçen günler  ',
    categoryIds: ['pop', 'rock'], capo: 3, bpm: 92, notes: 'not', favorite: true,
  });
});

test('form karşılaştırması ve şarkıdan form', () => {
  const song = normalizeSong({ id: 's', title: 'A', content: '[C]x', categoryIds: ['pop'], bpm: 90, createdAt: 1 });
  const form = songToForm(song);
  assert.equal(form.bpm, '90');
  assert.equal(sameForm(form, { ...form, categoryIds: ['pop'] }), true);
  assert.equal(sameForm(form, { ...form, title: 'B' }), false);
  assert.notEqual(createId(), createId());
});

test('kategori varsayılanları', () => {
  const category = normalizeCategory({ id: 'pop', name: ' Pop ' }, 3);
  assert.equal(category.name, 'Pop');
  assert.equal(category.color, 'slate');
  assert.equal(category.order, 3);
});
