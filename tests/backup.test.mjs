// Yedekleme: dosya biçimi, denetim, çakışma planı (hiçbir kayıt silinmez).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, planRestore, resolvePlan, summarizePlan, backupFileName, BackupError } from '../js/data/backup.js';

const cat = (id, name, order) => ({ id, name, color: 'sky', order, createdAt: 1 });
const song = (id, title, extra = {}) => ({ id, title, artist: 'Sanatçı', key: 'Am', content: `[Am]${title} sözleri`, categoryIds: [], createdAt: 1, updatedAt: 1, ...extra });
const score = (id, title, extra = {}) => ({ id, title, composer: '', key: { step: 5, alter: 0, mode: 'minor' }, time: '4/4', code: 'la4:4 si4 do5 re5 |', createdAt: 1, updatedAt: 1, ...extra });

function device() {
  return {
    categories: [cat('c1', 'Pop', 0), cat('c2', 'Türkü', 1)],
    songs: [song('s1', 'Işıklar', { categoryIds: ['c1'] }), song('s2', 'İstanbul', { categoryIds: ['c2'] })],
    setlists: [{ id: 'l1', name: 'Cuma', songIds: ['s2', 's1'], createdAt: 1, updatedAt: 1 }],
    scores: [score('n1', 'Hicaz Saz Semaisi', { key: { step: 5, alter: 0, mode: 'hicaz' }, photo: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' }) })],
  };
}

test('yedek alınır ve aynen geri okunur (Türkçe harfler, setlist sırası, nota fotoğrafı)', async () => {
  const backup = await buildBackup(device(), { appVersion: '0.12.0', now: Date.UTC(2026, 9, 31) });
  assert.equal(backup.format, 'repertuvarim-yedek');
  assert.deepEqual(backup.counts, { songs: 2, categories: 2, setlists: 1, scores: 1 });
  const text = JSON.stringify(backup);
  const back = parseBackup(text);
  assert.equal(back.songs[0].title, 'Işıklar');
  assert.equal(back.songs[1].title, 'İstanbul');
  assert.deepEqual(back.setlists[0].songIds, ['s2', 's1']);
  assert.equal(back.scores[0].key.mode, 'hicaz');
  assert.deepEqual([...new Uint8Array(await back.scores[0].photo.arrayBuffer())], [1, 2, 3, 250]);
  assert.equal(back.scores[0].photo.type, 'image/jpeg');
  assert.equal(back.skipped, 0);
});

test('geçersiz dosyalar anlaşılır hata verir', () => {
  const fails = (text, pattern) => assert.throws(() => parseBackup(text), (e) => e instanceof BackupError && pattern.test(e.message));
  fails('merhaba', /okunamadı/);
  fails('{"a":1}', /Repertuvarım yedeği değil/);
  fails(JSON.stringify({ format: 'repertuvarim-yedek', version: 99, data: {} }), /daha yeni/);
  fails(JSON.stringify({ format: 'repertuvarim-yedek', version: 1 }), /bozuk/);
  fails(JSON.stringify({ format: 'repertuvarim-yedek', version: 1, data: { songs: 'x' } }), /şarkılar bölümü/);
  fails(JSON.stringify({ format: 'repertuvarim-yedek', version: 1, data: { songs: [] } }), /hiç kayıt yok/);
  fails(JSON.stringify({ format: 'repertuvarim-yedek', version: 1, data: { songs: [{ title: '' }] } }), /hepsi bozuk/);
  const partly = parseBackup(JSON.stringify({ format: 'repertuvarim-yedek', version: 1, data: { songs: [{ title: 'İyi', content: 'x' }, { nope: 1 }, null] } }));
  assert.equal(partly.songs.length, 1);
  assert.equal(partly.skipped, 2);
  assert.ok(partly.songs[0].id);
});

test('aynı cihaza geri yükleme: her şey "zaten var", hiçbir şey eklenmez', async () => {
  const current = device();
  const backup = parseBackup(JSON.stringify(await buildBackup(current)));
  const plan = planRestore(backup, current);
  assert.deepEqual(summarizePlan(plan), {
    songs: { added: 0, same: 2, changed: 0 },
    categories: { added: 0, same: 2, changed: 0 },
    setlists: { added: 0, same: 1, changed: 0 },
    scores: { added: 0, same: 1, changed: 0 },
  });
  const out = resolvePlan(plan, current, 'keep');
  assert.equal(out.songs.length + out.categories.length + out.setlists.length + out.scores.length, 0);
});

test('boş cihaza geri yükleme: her şey eklenir, setlist sırası korunur', async () => {
  const backup = parseBackup(JSON.stringify(await buildBackup(device())));
  const empty = { songs: [], categories: [], setlists: [], scores: [] };
  const out = resolvePlan(planRestore(backup, empty), empty, 'keep');
  assert.equal(out.songs.length, 2);
  assert.equal(out.categories.length, 2);
  assert.deepEqual(out.setlists[0].songIds, ['s2', 's1']);
  assert.deepEqual(out.songs.find((s) => s.id === 's1').categoryIds, ['c1']);
  assert.equal(out.counts.added, 6);
});

test('başka cihaz: kategoriler adıyla eşleşir, yeni şarkılar eklenir, yinelenen şarkı tespit edilir', async () => {
  const other = {
    categories: [cat('x9', 'POP', 0)],
    songs: [song('z1', 'IŞIKLAR', { artist: 'SANATÇI', categoryIds: ['x9'] }), song('z2', 'Başka', {})],
    setlists: [],
    scores: [],
  };
  const backup = parseBackup(JSON.stringify(await buildBackup(device())));
  const plan = planRestore(backup, other);
  const sum = summarizePlan(plan);
  assert.equal(sum.categories.same, 1); // Pop = POP
  assert.equal(sum.categories.added, 1); // Türkü
  assert.equal(sum.songs.added, 1); // İstanbul
  assert.equal(sum.songs.changed, 1); // Işıklar: adı aynı, yazımı farklı

  const keep = resolvePlan(plan, other, 'keep');
  assert.deepEqual(keep.songs.map((s) => s.title), ['İstanbul']);
  const istanbul = keep.songs[0];
  assert.equal(istanbul.categoryIds.length, 1);
  assert.equal(keep.categories[0].name, 'Türkü');
  assert.equal(keep.categories[0].order, 1); // mevcutların arkasına
  assert.deepEqual(keep.setlists[0].songIds, [istanbul.id, 'z1']); // setlist bu cihazdaki şarkıyı gösterir

  const replace = resolvePlan(plan, other, 'replace');
  const updated = replace.songs.find((s) => s.id === 'z1');
  assert.equal(updated.title, 'Işıklar');
  assert.deepEqual(updated.categoryIds, ['x9']); // yedekteki Pop → bu cihazdaki POP
  assert.equal(replace.counts.updated, 1);

  const both = resolvePlan(plan, other, 'both');
  const copy = both.songs.find((s) => s.title === 'Işıklar (yedekten)');
  assert.ok(copy);
  assert.notEqual(copy.id, 'z1');
  assert.deepEqual(both.setlists[0].songIds, [both.songs.find((s) => s.title === 'İstanbul').id, copy.id]);
  // Hiçbir seçenek mevcut "Başka" şarkısına dokunmaz
  for (const out of [keep, replace, both]) assert.ok(!out.songs.some((s) => s.id === 'z2'));
});

test('değişmiş setlist ve nota: seçime göre korunur, güncellenir ya da ikisi de tutulur', async () => {
  const current = device();
  const changed = device();
  changed.setlists[0].songIds = ['s1', 's2'];
  changed.scores[0].code = 'la4:2 si4 |';
  const backup = parseBackup(JSON.stringify(await buildBackup(changed)));
  const plan = planRestore(backup, current);
  assert.equal(summarizePlan(plan).setlists.changed, 1);
  assert.equal(summarizePlan(plan).scores.changed, 1);
  assert.equal(resolvePlan(plan, current, 'keep').setlists.length, 0);
  const replace = resolvePlan(plan, current, 'replace');
  assert.deepEqual(replace.setlists[0], { ...current.setlists[0], songIds: ['s1', 's2'], updatedAt: replace.setlists[0].updatedAt });
  assert.equal(replace.scores[0].id, 'n1');
  assert.equal(replace.scores[0].code, 'la4:2 si4 |');
  const both = resolvePlan(plan, current, 'both');
  assert.equal(both.setlists[0].name, 'Cuma (yedekten)');
  assert.equal(both.scores[0].title, 'Hicaz Saz Semaisi (yedekten)');
});

test('şarkı dosyası: yalnızca seçilen şarkılar ve kategorileri', async () => {
  const d = device();
  const backup = await buildBackup({ ...d, songs: [d.songs[1]] }, { kind: 'songs' });
  assert.equal(backup.kind, 'songs');
  assert.deepEqual(backup.counts, { songs: 1, categories: 1, setlists: 0, scores: 0 });
  assert.equal(backupFileName({ kind: 'songs', title: 'İstanbul’u Dinliyorum', now: Date.UTC(2026, 9, 31, 12) }), 'repertuvarim-istanbul-u-dinliyorum-2026-10-31.json');
  assert.equal(backupFileName({ now: Date.UTC(2026, 9, 31, 12) }), 'repertuvarim-yedek-2026-10-31.json');
});
