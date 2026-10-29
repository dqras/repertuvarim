// Türkçe arama ve sıralama yardımcılarının testleri.
// Çalıştırmak için (Node.js kurulu bir bilgisayarda, proje klasöründe): node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareText, foldForSearch, formatBytes, matchesQuery } from '../js/lib/text.js';

test('arama metni Türkçe harflerden bağımsızdır', () => {
  assert.equal(foldForSearch('Rüzgâr'), 'ruzgar');
  assert.equal(foldForSearch('RÜZGÂR'), 'ruzgar');
  assert.equal(foldForSearch('Çiğdem Öğüt'), 'cigdem ogut');
  assert.equal(foldForSearch('  Şarkı   Sözü '), 'sarki sozu');
});

test('noktalı ve noktasız I doğru küçülür', () => {
  assert.equal(foldForSearch('İstanbul'), 'istanbul');
  assert.equal(foldForSearch('ISTANBUL'), 'istanbul');
  assert.equal(foldForSearch('Ilık'), 'ilik');
});

test('boş değerler hata vermez', () => {
  assert.equal(foldForSearch(null), '');
  assert.equal(foldForSearch(undefined), '');
  assert.equal(foldForSearch(''), '');
});

test('aranan kelimelerin hepsi geçmeli', () => {
  const text = foldForSearch('Ayrılık Rüzgârı Selim Kaya');
  assert.equal(matchesQuery(text, foldForSearch('selim ayr')), true);
  assert.equal(matchesQuery(text, foldForSearch('RUZGARI')), true);
  assert.equal(matchesQuery(text, foldForSearch('selim xyz')), false);
  assert.equal(matchesQuery(text, ''), true);
});

test('sıralama Türk alfabesine uyar', () => {
  const words = ['Üşüyen', 'Çay', 'Ilık', 'İstanbul', 'Şehrin', 'Sahilde', 'Özlem', 'Ayrılık', 'Gülümse', 'Gece', 'Yağmur', 'Kırık'];
  const expected = ['Ayrılık', 'Çay', 'Gece', 'Gülümse', 'Ilık', 'İstanbul', 'Kırık', 'Özlem', 'Sahilde', 'Şehrin', 'Üşüyen', 'Yağmur'];
  assert.deepEqual([...words].sort(compareText), expected);
});

test('alan büyüklüğü okunur biçimde yazılır', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(86016), '84 KB');
  assert.equal(formatBytes(1536), '1,5 KB');
  assert.equal(formatBytes(5 * 1024 ** 3), '5 GB');
  assert.equal(formatBytes(null), '0 B');
});

test('sıralamada büyük/küçük harf fark etmez', () => {
  assert.equal(compareText('liman', 'LİMAN'), 0);
  assert.equal(compareText(null, ''), 0);
});
