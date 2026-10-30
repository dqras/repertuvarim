import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOOKMARKLET, IMPORT_SCRIPT } from '../js/music/bookmarklet.js';

test('yer imi tek satır, yüzde işareti ve // içermez', () => {
  assert.ok(BOOKMARKLET.startsWith('javascript:'));
  assert.ok(!BOOKMARKLET.includes('\n'));
  assert.ok(!BOOKMARKLET.includes('%'));
  assert.ok(!BOOKMARKLET.includes('//'));
  assert.ok(!IMPORT_SCRIPT.includes('//'));
  assert.ok(BOOKMARKLET.length < 400, 'yer imi kısa bir yükleyici olmalı');
});

test('yer imi ve aktarma kodu geçerli JavaScript', () => {
  assert.doesNotThrow(() => new Function(BOOKMARKLET.slice('javascript:'.length)));
  assert.doesNotThrow(() => new Function(IMPORT_SCRIPT));
});

test('yer imi uygulamanın adresindeki aktar.js dosyasını yükler', () => {
  assert.match(BOOKMARKLET, /dqras\.github\.io\\\/repertuvarim\\\/aktar\.js/);
});

test('yayımlanan aktar.js, koddaki aktarma koduyla aynı (node tools/build-aktar.mjs)', () => {
  const file = readFileSync(new URL('../aktar.js', import.meta.url), 'utf8');
  assert.equal(file, `${IMPORT_SCRIPT}\n`);
});
