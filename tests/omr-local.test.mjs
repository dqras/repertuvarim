// Telefondaki nota okuyucu: kodla çizilmiş sentetik bir porteyi okur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readScoreBitmap } from '../js/music/omr-local.js';
import { pitchLabel } from '../js/music/notation.js';

/** Basit çizim: beyaz kâğıt üzerine porte, notalar, saplar, kirişler, ölçü çizgileri. */
function drawScore({ notes, sp = 18, width = 1400, angle = 0, shade = false }) {
  const height = 260;
  const img = new Float32Array(width * height).fill(255);
  const top = 90;
  const lineY = (i) => top + i * sp; // 0 = üst çizgi
  const posY = (pos) => top + 4 * sp - (pos * sp) / 2; // pos 0 = alt çizgi (mi4)
  const ink = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < width && y < height) img[y * width + x] = 0;
  };
  const rect = (x0, y0, x1, y1) => {
    for (let y = Math.round(y0); y <= Math.round(y1); y += 1) for (let x = Math.round(x0); x <= Math.round(x1); x += 1) ink(x, y);
  };
  // porte
  for (let i = 0; i < 5; i += 1) rect(40, lineY(i) - 1, width - 40, lineY(i) + 1);
  rect(40, lineY(0), 42, lineY(4));
  const head = (cx, cy, hollow, whole = false) => {
    const a = sp * (whole ? 0.85 : 0.68);
    const b = sp * 0.5;
    const t = -0.35;
    for (let y = -sp; y <= sp; y += 1) {
      for (let x = -sp; x <= sp; x += 1) {
        const u = x * Math.cos(t) + y * Math.sin(t);
        const v = -x * Math.sin(t) + y * Math.cos(t);
        const r = (u * u) / (a * a) + (v * v) / (b * b);
        if (r <= 1 && (!hollow || r >= 0.42 || Math.abs(v) > b * 0.62)) ink(cx + x, cy + y);
      }
    }
  };
  let x = 140;
  const beamGroup = [];
  for (const n of notes) {
    if (n === '|') {
      rect(x - sp * 0.5, lineY(0), x - sp * 0.5 + 2, lineY(4));
      x += sp * 1.2;
      continue;
    }
    const cy = posY(n.pos);
    if (n.sharp) {
      const sx = x - sp * 1.6;
      rect(sx, cy - sp * 1.3, sx + 1, cy + sp * 1.3);
      rect(sx + sp * 0.55, cy - sp * 1.4, sx + sp * 0.55 + 1, cy + sp * 1.2);
      rect(sx - 2, cy - sp * 0.55, sx + sp * 0.8, cy - sp * 0.35);
      rect(sx - 2, cy + sp * 0.25, sx + sp * 0.8, cy + sp * 0.45);
    }
    head(x, cy, n.dur <= 2, n.dur === 1);
    const up = n.pos < 4;
    const stemX = up ? x + sp * 0.62 : x - sp * 0.62;
    if (n.dur >= 2) {
      const tip = up ? cy - sp * 3.5 : cy + sp * 3.5;
      rect(stemX - 1, Math.min(cy, tip), stemX, Math.max(cy, tip));
      if (n.dur === 8) beamGroup.push({ stemX, tip, up });
    }
    if (n.dots) rect(x + sp * 1.0, cy - (n.pos % 2 === 0 ? sp * 0.7 : sp * 0.2), x + sp * 1.3, cy - (n.pos % 2 === 0 ? sp * 0.4 : -sp * 0.1));
    if (beamGroup.length === 2) {
      const [a, b] = beamGroup;
      const y = a.up ? Math.min(a.tip, b.tip) : Math.max(a.tip, b.tip);
      rect(a.stemX - 1, a.up ? y : y - sp * 0.5, b.stemX, a.up ? y + sp * 0.5 : y);
      beamGroup.length = 0;
    }
    x += sp * (n.dur === 1 ? 4 : n.dur === 2 ? 3.2 : 2.6);
  }
  rect(x, lineY(0), x + 2, lineY(4));
  let data = Uint8Array.from(img);
  if (shade) data = data.map((v, i) => Math.round(v * (0.65 + 0.3 * ((i % width) / width))));
  if (angle) {
    const out = new Uint8Array(width * height).fill(255);
    const t = (angle * Math.PI) / 180;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sx = Math.round(Math.cos(t) * (x - width / 2) + Math.sin(t) * (y - height / 2) + width / 2);
        const sy = Math.round(-Math.sin(t) * (x - width / 2) + Math.cos(t) * (y - height / 2) + height / 2);
        if (sx >= 0 && sy >= 0 && sx < width && sy < height) out[y * width + x] = data[sy * width + sx];
      }
    }
    data = out;
  }
  return { width, height, data };
}

const MELODY = [
  { pos: 5, dur: 4 }, { pos: 6, dur: 4 }, { pos: 7, dur: 8 }, { pos: 8, dur: 8 }, { pos: 7, dur: 4 }, '|',
  { pos: 3, dur: 2 }, { pos: 4, dur: 4, sharp: true }, { pos: 5, dur: 4 }, '|',
  { pos: 2, dur: 2, dots: 1 }, { pos: 0, dur: 4 }, '|',
  { pos: 5, dur: 1 },
];
// pos: 0 = mi4 (alt çizgi), 3 = la4, 4 = si4, 5 = do5 …
const EXPECTED = [['do5:4', 're5:4', 'mi5:8', 'fa5:8', 'mi5:4'], ['la4:2', 'si♯4:4', 'do5:4'], ['sol4:2.', 'mi4:4'], ['do5:1']];
const show = (m) => m.map((n) => (n.rest ? 'sus' : pitchLabel(n.step, n.alter) + n.octave) + ':' + n.dur + '.'.repeat(n.dots));

test('sentetik porte: perdeler, süreler, noktalar, diyez ve ölçüler', () => {
  const result = readScoreBitmap(drawScore({ notes: MELODY }));
  assert.deepEqual(result.measures.map(show), EXPECTED);
  assert.equal(result.time, '4/4'); // ölçü işareti yok: sürelerden tahmin
  assert.ok(result.warnings.includes('time-guessed'));
});

test('eğik ve gölgeli "fotoğraf" da okunur', () => {
  const result = readScoreBitmap(drawScore({ notes: MELODY, angle: 1.6, shade: true }));
  assert.deepEqual(result.measures.map(show), EXPECTED);
});

/** Görüntüyü k kat küçültür (k×k kutunun ortalaması: gerçek küçük ekran görüntüsü gibi gri kenarlı). */
function shrink(img, k) {
  const width = Math.floor(img.width / k);
  const height = Math.floor(img.height / k);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < k; dy += 1) for (let dx = 0; dx < k; dx += 1) sum += img.data[(y * k + dy) * img.width + x * k + dx];
      data[y * width + x] = Math.round(sum / (k * k));
    }
  }
  return { width, height, data };
}

test('küçük (düşük çözünürlüklü) görüntü büyütülüp okunur', () => {
  const result = readScoreBitmap(shrink(drawScore({ notes: MELODY }), 3)); // porte aralığı 6 piksel
  // Çok küçük görüntüde ince işaretler (diyez, nokta) kaybolabilir: ölçüler ve notaların çoğu doğru olmalı.
  assert.equal(result.measures.length, EXPECTED.length);
  const got = result.measures.map(show).flat();
  const want = EXPECTED.flat();
  const pitch = (t) => t.split(':')[0].replace('♯', '');
  // en uzun ortak dizi (eksik bir nota sonrakileri kaydırmasın)
  const L = Array.from({ length: want.length + 1 }, () => new Array(got.length + 1).fill(0));
  for (let i = 1; i <= want.length; i += 1) {
    for (let j = 1; j <= got.length; j += 1) {
      L[i][j] = pitch(want[i - 1]) === pitch(got[j - 1]) ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    }
  }
  const same = L[want.length][got.length];
  assert.ok(same >= want.length - 1, `${same}/${want.length}: ${got.join(' ')}`);
});

test('porte yoksa boş sonuç', () => {
  const blank = { width: 300, height: 200, data: new Uint8Array(300 * 200).fill(255) };
  const result = readScoreBitmap(blank);
  assert.equal(result.measures.length, 0);
  assert.ok(result.warnings.includes('no-staff'));
});
