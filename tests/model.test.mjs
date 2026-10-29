// Şarkı ve kategori veri biçiminin testleri.
// Çalıştırmak için (Node.js kurulu bir bilgisayarda, proje klasöründe): node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSong, normalizeCategory } from '../js/data/model.js';

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

test('kategori varsayılanları', () => {
  const category = normalizeCategory({ id: 'pop', name: ' Pop ' }, 3);
  assert.equal(category.name, 'Pop');
  assert.equal(category.color, 'slate');
  assert.equal(category.order, 3);
});
