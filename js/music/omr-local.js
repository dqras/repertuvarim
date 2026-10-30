/**
 * Telefonda çalışan nota okuyucu (internet gerekmez).
 *
 * Bilgisayarda yazılmış (basılı) notaların fotoğrafını ya da ekran görüntüsünü okur:
 * porte çizgileri, nota başları (dolu/boş), saplar, kirişler ve bayraklar (süre), noktalar,
 * suslar, değiştirici işaretleri (diyez, bemol, natürel), donanım, ölçü işareti (6/8, C …),
 * ölçü çizgileri ve üçlemeler. Piyano notalarında üstteki (ezgi) porte okunur; akorlarda en
 * üstteki nota alınır. Süslemeler (küçük notalar), bağlar, yazılar ve nüanslar yok sayılır.
 *
 * Klasik görüntü işleme kullanılır (yapay zekâ modeli yok); bu yüzden net, düz, basılı
 * notalarda iyi, el yazısı ya da eğik fotoğraflarda zayıf sonuç verir.
 *
 * Bu dosyanın çekirdeği (readScoreBitmap) ekrandan bağımsızdır; gri tonlu görüntü
 * ({ width, height, data }) alır. Testleri: tests/omr-local.test.mjs
 * Ölçüler "staff space" (sp: iki porte çizgisi arası) cinsindendir.
 */
import { guessMode, majorTonicOf } from './notation.js';
import { DIGIT_TEMPLATES, TEMPLATE_W, TEMPLATE_H } from './omr-digits.js';

const TARGET_SP = 18; // görüntü, porte aralığı bu kadar piksel olacak şekilde ölçeklenir

// --- Görüntü yardımcıları -------------------------------------------------------------

/** Otsu eşiği: koyu (mürekkep) ile açık (kâğıt) arasındaki en iyi ayrım. */
function otsu(gray) {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return Math.min(Math.max(threshold, 60), 200);
}

function binarize(gray, threshold = null) {
  const t = threshold ?? Math.max(otsu(gray), 160);
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) out[i] = gray[i] <= t ? 1 : 0;
  return out;
}

/** Gri görüntüyü ölçekler (iki doğrusal ara değer). */
function resample(gray, w, h, scale) {
  const W = Math.max(1, Math.round(w * scale));
  const H = Math.max(1, Math.round(h * scale));
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < W; x += 1) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const a = gray[y0 * w + x0] * (1 - fx) + gray[y0 * w + x1] * fx;
      const b = gray[y1 * w + x0] * (1 - fx) + gray[y1 * w + x1] * fx;
      out[y * W + x] = Math.round(a * (1 - fy) + b * fy);
    }
  }
  return { gray: out, w: W, h: H };
}

/**
 * Fotoğraflarda kâğıt her yerde aynı beyazlıkta değildir (gölge, sarı ışık). Kâğıdın yerel
 * parlaklığı bulunup her piksel ona bölünür; böylece kâğıt her yerde beyaz olur.
 */
function flattenIllumination(gray, w, h) {
  const B = Math.max(8, Math.round(Math.min(w, h) / 50));
  const gw = Math.ceil(w / B);
  const gh = Math.ceil(h / B);
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      // bloğun en parlak %10'u kâğıt sayılır
      const values = [];
      for (let y = gy * B; y < Math.min(h, gy * B + B); y += 2) for (let x = gx * B; x < Math.min(w, gx * B + B); x += 2) values.push(gray[y * w + x]);
      values.sort((a, b) => b - a);
      grid[gy * gw + gx] = values[Math.floor(values.length * 0.1)] ?? 255;
    }
  }
  // mürekkeple dolu bloklar için komşuların en parlağı
  const bg = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const x = gx + dx;
        const y = gy + dy;
        if (x >= 0 && y >= 0 && x < gw && y < gh) m = Math.max(m, grid[y * gw + x]);
      }
      bg[gy * gw + gx] = Math.max(m, 40);
    }
  }
  let uniform = true;
  for (let i = 0; i < bg.length; i += 1) if (bg[i] < 235) uniform = false;
  if (uniform) return gray; // ekran görüntüsü: değiştirme
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / B - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x += 1) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / B - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const b = (bg[y0 * gw + x0] * (1 - tx) + bg[y0 * gw + x1] * tx) * (1 - ty) + (bg[y1 * gw + x0] * (1 - tx) + bg[y1 * gw + x1] * tx) * ty;
      out[y * w + x] = Math.min(255, Math.round((gray[y * w + x] * 255) / b));
    }
  }
  return out;
}

/** Eğik çekilmiş fotoğrafın açısı (derece): porte çizgileri en çok hangi açıda yatay hizalanıyor? */
function skewAngle(bin, w, h) {
  const xs = [];
  const ys = [];
  const step = Math.max(1, Math.round((w * h) / 1500000));
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += step) if (bin[y * w + x]) { xs.push(x); ys.push(y); }
  if (xs.length < 100) return 0;
  const score = (deg) => {
    const t = Math.tan((deg * Math.PI) / 180);
    const hist = new Float64Array(h + Math.ceil(w * 0.1) + 2);
    const off = Math.ceil(w * 0.08);
    for (let i = 0; i < xs.length; i += 1) {
      const y = Math.round(ys[i] - xs[i] * t) + off;
      if (y >= 0 && y < hist.length) hist[y] += 1;
    }
    let s = 0;
    for (let i = 0; i < hist.length; i += 1) s += hist[i] * hist[i];
    return s;
  };
  let best = 0;
  let bestScore = score(0);
  for (let deg = -4; deg <= 4.001; deg += 0.25) {
    const sc = score(deg);
    if (sc > bestScore) {
      bestScore = sc;
      best = deg;
    }
  }
  let fine = best;
  for (let deg = best - 0.25; deg <= best + 0.25; deg += 0.05) {
    const sc = score(deg);
    if (sc > bestScore) {
      bestScore = sc;
      fine = deg;
    }
  }
  return fine;
}

/** Görüntüyü döndürür (kenarlar beyaz). */
function rotate(gray, w, h, deg) {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const cx = w / 2;
  const cy = h / 2;
  const out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // hedef (x,y) için kaynak nokta
      const sx = c * (x - cx) - s * (y - cy) + cx;
      const sy = s * (x - cx) + c * (y - cy) + cy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * w + x0;
      out[y * w + x] = Math.round((gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + w] * (1 - fx) + gray[i + w + 1] * fx) * fy);
    }
  }
  return out;
}

/** Dikey koşu uzunluklarından çizgi kalınlığı (lt) ve porte aralığı (sp). */
function runStats(bin, w, h) {
  const black = new Float64Array(256);
  const white = new Float64Array(256);
  for (let x = 0; x < w; x += 2) {
    let run = 1;
    for (let y = 1; y <= h; y += 1) {
      if (y < h && bin[y * w + x] === bin[(y - 1) * w + x]) run += 1;
      else {
        if (run < 256) (bin[(y - 1) * w + x] ? black : white)[run] += 1;
        run = 1;
      }
    }
  }
  let lt = 1;
  for (let i = 1; i < 64; i += 1) if (black[i] > black[lt]) lt = i;
  const startWhite = Math.max(2, Math.round(lt * 0.7));
  let wm = startWhite;
  for (let i = startWhite; i < 200; i += 1) if (white[i] > white[wm]) wm = i;
  // Ağırlıklı ortalama (kenar yumuşatması yüzünden koşular ±1 değişir)
  const avg = (hist, center) => {
    let s = 0;
    let n = 0;
    for (let i = Math.max(1, center - 1); i <= center + 1; i += 1) {
      s += hist[i] * i;
      n += hist[i];
    }
    return n ? s / n : center;
  };
  const ltAvg = avg(black, lt);
  return { lt: ltAvg, sp: avg(white, wm) + ltAvg };
}

/** 8-komşulu bağlı bileşenler. Sonuç: { labels, comps: [{ id, x0, y0, x1, y1, area }] } */
function components(bin, w, h) {
  const labels = new Int32Array(w * h);
  const parent = [0];
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  let next = 1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!bin[i]) continue;
      const n = [];
      if (x > 0 && labels[i - 1]) n.push(labels[i - 1]);
      if (y > 0) {
        if (labels[i - w]) n.push(labels[i - w]);
        if (x > 0 && labels[i - w - 1]) n.push(labels[i - w - 1]);
        if (x < w - 1 && labels[i - w + 1]) n.push(labels[i - w + 1]);
      }
      if (!n.length) {
        parent.push(next);
        labels[i] = next;
        next += 1;
      } else {
        let m = n[0];
        for (const v of n) if (v < m) m = v;
        labels[i] = m;
        for (const v of n) union(m, v);
      }
    }
  }
  const map = new Int32Array(next);
  const comps = [];
  for (let i = 1; i < next; i += 1) {
    const r = find(i);
    if (!map[r]) {
      comps.push({ id: comps.length + 1, x0: Infinity, y0: Infinity, x1: -1, y1: -1, area: 0 });
      map[r] = comps.length;
    }
    map[i] = map[r];
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!labels[i]) continue;
      const id = map[labels[i]];
      labels[i] = id;
      const c = comps[id - 1];
      c.area += 1;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
    }
  }
  return { labels, comps };
}

/**
 * Kapalı boşlukları (nota başının içi gibi) doldurur. Yalnızca küçük boşluklar doldurulur:
 * alanı maxArea pikselden, yüksekliği maxH pikselden, genişliği maxW pikselden büyük olanlar kalır.
 * into: verilirse doldurulan pikseller ona da yazılır.
 */
function fillHoles(bin, w, h, maxArea, maxW = Infinity, maxH = Infinity, into = null) {
  const out = into ?? bin.slice();
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let start = 0; start < w * h; start += 1) {
    if (bin[start] || seen[start]) continue;
    const pixels = [];
    let border = false;
    let x0 = Infinity;
    let x1 = -1;
    let y0 = Infinity;
    let y1 = -1;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      if (pixels.length <= maxArea) pixels.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && !bin[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !bin[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !bin[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !bin[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
    }
    if (!border && pixels.length <= maxArea && x1 - x0 < maxW && y1 - y0 < maxH) for (const i of pixels) out[i] = 1;
  }
  return out;
}

/** Dikdörtgen yapı elemanıyla aşındırma + genişletme (açma): ince çizgileri siler. */
function opening(bin, w, h, kw, kh) {
  const rw = Math.floor(kw / 2);
  const rh = Math.floor(kh / 2);
  const er = new Uint8Array(w * h);
  // yatay aşındırma
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    let run = 0;
    const row = y * w;
    const len = new Int32Array(w);
    for (let x = w - 1; x >= 0; x -= 1) {
      run = bin[row + x] ? run + 1 : 0;
      len[x] = run; // sağa doğru kesintisiz siyah uzunluğu
    }
    for (let x = rw; x < w - rw; x += 1) if (len[x - rw] >= 2 * rw + 1) tmp[row + x] = 1;
  }
  // dikey aşındırma
  for (let x = 0; x < w; x += 1) {
    let run = 0;
    const len = new Int32Array(h);
    for (let y = h - 1; y >= 0; y -= 1) {
      run = tmp[y * w + x] ? run + 1 : 0;
      len[y] = run;
    }
    for (let y = rh; y < h - rh; y += 1) if (len[y - rh] >= 2 * rh + 1) er[y * w + x] = 1;
  }
  // genişletme
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let last = -1e9;
    for (let x = 0; x < w; x += 1) {
      if (er[row + x]) last = x;
      if (x - last <= rw) tmp[row + x] = 2;
    }
    last = 1e9;
    for (let x = w - 1; x >= 0; x -= 1) {
      if (er[row + x]) last = x;
      if (last - x <= rw) tmp[row + x] = 2;
    }
  }
  for (let x = 0; x < w; x += 1) {
    let last = -1e9;
    for (let y = 0; y < h; y += 1) {
      if (tmp[y * w + x] === 2) last = y;
      if (y - last <= rh) dil[y * w + x] = 1;
    }
    last = 1e9;
    for (let y = h - 1; y >= 0; y -= 1) {
      if (tmp[y * w + x] === 2) last = y;
      if (last - y <= rh) dil[y * w + x] = 1;
    }
  }
  for (let i = 0; i < dil.length; i += 1) dil[i] = dil[i] && bin[i] ? 1 : 0;
  return dil;
}

// --- Porteler ---------------------------------------------------------------------------

function findStaves(bin, w, h, lt, sp) {
  const counts = new Int32Array(h);
  for (let y = 0; y < h; y += 1) {
    let c = 0;
    // en uzun yatay siyah koşu: yazı satırlarını porte çizgisinden ayırır
    let run = 0;
    let best = 0;
    for (let x = 0; x < w; x += 1) {
      if (bin[y * w + x]) {
        c += 1;
        run += 1;
        if (run > best) best = run;
      } else run = 0;
    }
    counts[y] = best;
  }
  let max = 0;
  for (let y = 0; y < h; y += 1) if (counts[y] > max) max = counts[y];
  const limit = Math.max(max * 0.3, sp * 12);
  const lines = [];
  for (let y = 0; y < h; y += 1) {
    if (counts[y] < limit) continue;
    const last = lines[lines.length - 1];
    if (last && y - last.b <= 1) {
      last.b = y;
    } else lines.push({ a: y, b: y });
  }
  for (const line of lines) line.y = (line.a + line.b) / 2;
  const staves = [];
  for (let i = 0; i + 4 < lines.length; ) {
    const group = lines.slice(i, i + 5);
    const gaps = group.slice(1).map((l, k) => l.y - group[k].y);
    const ok = gaps.every((g) => Math.abs(g - sp) < sp * 0.3);
    if (ok) {
      staves.push({ lines: group });
      i += 5;
    } else i += 1;
  }
  for (const staff of staves) {
    staff.sp = (staff.lines[4].y - staff.lines[0].y) / 4;
    staff.top = staff.lines[0].y;
    staff.bottom = staff.lines[4].y;
    staff.mid = staff.lines[2].y;
    // yatay uzantı: çizgilerin çoğunun siyah olduğu en uzun aralık
    let best = [0, 0];
    let start = -1;
    let gap = 0;
    for (let x = 0; x <= w; x += 1) {
      let n = 0;
      if (x < w) {
        for (const line of staff.lines) {
          let black = false;
          for (let y = line.a; y <= line.b; y += 1) if (bin[y * w + x]) black = true;
          if (black) n += 1;
        }
      }
      if (n >= 4) {
        if (start < 0) start = x;
        gap = 0;
      } else if (start >= 0) {
        gap += 1;
        if (gap > 3 || x === w) {
          const end = x - gap;
          if (end - start > best[1] - best[0]) best = [start, end];
          start = -1;
          gap = 0;
        }
      }
    }
    staff.x0 = best[0];
    staff.x1 = best[1];
  }
  return staves.filter((s) => s.x1 - s.x0 > s.sp * 10);
}

/** Porte çizgilerini siler; çizgiyi kesen şekillerin (sap, nota başı) piksellerine dokunmaz. */
function removeStaffLines(bin, w, h, staves, lt) {
  const out = bin.slice();
  const limit = Math.max(2, Math.round(lt * 0.6));
  for (const staff of staves) {
    for (const line of staff.lines) {
      const a = Math.max(0, line.a - 1);
      const b = Math.min(h - 1, line.b + 1);
      for (let x = Math.max(0, staff.x0 - 2); x <= Math.min(w - 1, staff.x1 + 2); x += 1) {
        // çizgi bandının üstünde ve altında ne kadar siyah var?
        let top = a;
        while (top <= b && !bin[top * w + x]) top += 1;
        if (top > b) continue;
        let bottom = b;
        while (bottom >= a && !bin[bottom * w + x]) bottom -= 1;
        let up = 0;
        for (let y = top - 1; y >= 0 && bin[y * w + x] && up <= limit + 1; y -= 1) up += 1;
        let down = 0;
        for (let y = bottom + 1; y < h && bin[y * w + x] && down <= limit + 1; y += 1) down += 1;
        if (up + down <= limit) for (let y = top; y <= bottom; y += 1) out[y * w + x] = 0;
      }
    }
  }
  return out;
}

// --- Şekil ölçümleri ------------------------------------------------------------------------

/** Bir bileşenin dikey çizgileri: en az minLen uzunlukta dikey koşusu olan sütun grupları. */
function verticalStrokes(labels, w, comp, minLen) {
  const cols = [];
  for (let x = comp.x0; x <= comp.x1; x += 1) {
    let run = 0;
    let best = 0;
    let bestEnd = 0;
    for (let y = comp.y0; y <= comp.y1 + 1; y += 1) {
      if (y <= comp.y1 && labels[y * w + x] === comp.id) {
        run += 1;
        if (run > best) {
          best = run;
          bestEnd = y;
        }
      } else run = 0;
    }
    if (best >= minLen) cols.push({ x, top: bestEnd - best + 1, bottom: bestEnd, len: best });
  }
  const strokes = [];
  for (const col of cols) {
    const last = strokes[strokes.length - 1];
    if (last && col.x - last.x1 <= 1) {
      last.x1 = col.x;
      last.top = Math.min(last.top, col.top);
      last.bottom = Math.max(last.bottom, col.bottom);
      last.len = Math.max(last.len, col.len);
    } else strokes.push({ x0: col.x, x1: col.x, top: col.top, bottom: col.bottom, len: col.len });
  }
  return strokes;
}

/** Bileşenin yalnızca yFrom..yTo satırlarındaki piksellerinin kutusu (yoksa null). */
function subBox(labels, w, comp, yFrom, yTo) {
  const box = { id: comp.id, x0: Infinity, x1: -1, y0: Infinity, y1: -1, area: 0 };
  for (let y = Math.max(comp.y0, Math.round(yFrom)); y <= Math.min(comp.y1, Math.round(yTo)); y += 1) {
    for (let x = comp.x0; x <= comp.x1; x += 1) {
      if (labels[y * w + x] !== comp.id) continue;
      box.area += 1;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
  }
  return box.area ? box : null;
}

function compFill(labels, w, comp) {
  return comp.area / ((comp.x1 - comp.x0 + 1) * (comp.y1 - comp.y0 + 1));
}

/** Bileşeni TEMPLATE_W × TEMPLATE_H ızgarasına küçültür (her hücre: siyah oranı 0..1). */
function sampleGrid(labels, w, comp, ids = [comp.id]) {
  const grid = new Float32Array(TEMPLATE_W * TEMPLATE_H);
  const cw = (comp.x1 - comp.x0 + 1) / TEMPLATE_W;
  const ch = (comp.y1 - comp.y0 + 1) / TEMPLATE_H;
  for (let gy = 0; gy < TEMPLATE_H; gy += 1) {
    for (let gx = 0; gx < TEMPLATE_W; gx += 1) {
      let n = 0;
      let k = 0;
      const xa = comp.x0 + gx * cw;
      const ya = comp.y0 + gy * ch;
      for (let y = Math.floor(ya); y < Math.ceil(ya + ch); y += 1) {
        for (let x = Math.floor(xa); x < Math.ceil(xa + cw); x += 1) {
          k += 1;
          if (ids.includes(labels[y * w + x])) n += 1;
        }
      }
      grid[gy * TEMPLATE_W + gx] = k ? n / k : 0;
    }
  }
  return grid;
}

/** En yakın rakam: { digit, score } (score: ortalama fark; küçük = iyi). */
function classifyDigit(grid, aspect, allowed = null) {
  let best = { digit: null, score: Infinity };
  for (const t of DIGIT_TEMPLATES) {
    if (allowed && !allowed.includes(t.digit)) continue;
    let d = 0;
    for (let i = 0; i < grid.length; i += 1) d += Math.abs(grid[i] - t.grid[i]);
    d /= grid.length;
    d += Math.abs(Math.log(aspect / t.aspect)) * 0.15;
    if (d < best.score) best = { digit: t.digit, score: d };
  }
  return best;
}

// --- Bir portenin okunması -------------------------------------------------------------

const DIATONIC_BOTTOM = { treble: 30, bass: 18 }; // alt çizgi: mi4 (sol anahtarı), sol2 (fa anahtarı)

function readStaff(ctx, staff, fifthsGuess) {
  const { w, h, bin, lineBin, noStaff, labels, comps } = ctx;
  const { sp } = staff; // bu portenin gerçek aralığı
  const posOf = (y) => (staff.bottom - y) / (sp / 2);
  const yOfPos = (p) => staff.bottom - (p * sp) / 2;
  const zoneTop = staff.top - 5 * sp;
  const zoneBottom = staff.bottom + 5 * sp;
  const inZone = (c) => c.y1 >= zoneTop && c.y0 <= zoneBottom && c.x1 >= staff.x0 - sp && c.x0 <= staff.x1 + sp;
  const staffComps = comps.filter(inZone);
  const used = new Set();

  // 1) Anahtar: portenin başındaki büyük şekil
  let clef = 'treble';
  let headerEnd = staff.x0 + sp * 0.5;
  const clefComp = staffComps
    .filter((c) => c.x0 <= staff.x0 + 3 * sp && c.x0 >= staff.x0 - sp && c.y1 - c.y0 >= 2.5 * sp)
    .sort((a, b) => b.area - a.area)[0];
  if (clefComp) {
    used.add(clefComp.id);
    // anahtar başka bir şekle (prova numarası kutusu gibi) değiyorsa yalnızca porte bölgesindeki kısmı
    headerEnd = (subBox(labels, w, clefComp, staff.top - sp * 1.5, staff.bottom + sp * 1.5) ?? clefComp).x1;
    const height = (clefComp.y1 - clefComp.y0) / sp;
    if (height < 4.8 && clefComp.y1 < staff.bottom - sp * 0.3) {
      clef = 'bass';
      // fa anahtarının iki noktası
      for (const c of staffComps) {
        if (c.x0 > clefComp.x1 && c.x0 < clefComp.x1 + sp && c.y1 - c.y0 < sp * 0.6) {
          used.add(c.id);
          headerEnd = Math.max(headerEnd, c.x1);
        }
      }
    }
  }

  // 2) Ölçü işaretleri: üst üste iki rakam (porte üst ve alt yarısında) ya da ortada C
  const meters = [];
  {
    const classify = (c, allowed = null) => ({ c, ...classifyDigit(sampleGrid(labels, w, c), (c.x1 - c.x0 + 1) / (c.y1 - c.y0 + 1), allowed) });
    // Ölçü işaretinde olası rakamlar: üstte 2–9 (12 için 1), altta 2, 4, 8 (1, 16 nadir)
    const UPPER = [2, 3, 4, 5, 6, 7, 9];
    const LOWER = [2, 4, 8];
    const half = (c) => {
      const ch = (c.y1 - c.y0 + 1) / sp;
      const cw = (c.x1 - c.x0 + 1) / sp;
      if (ch < 1.3 || ch > 2.5 || cw < 0.5 || cw > 2.4 || c.x0 < headerEnd - sp * 0.5) return null;
      const center = posOf((c.y0 + c.y1) / 2);
      if (center > 5 && center < 7.3 && c.y0 >= staff.top - sp * 0.6) return 'upper';
      if (center > 0.7 && center < 3 && c.y1 <= staff.bottom + sp * 0.6) return 'lower';
      return null;
    };
    const uppers = staffComps.filter((c) => half(c) === 'upper');
    const lowers = staffComps.filter((c) => half(c) === 'lower');
    const DEN = [1, 2, 4, 8, 16];
    for (const up of uppers) {
      const lowParts = lowers.filter((lo) => lo.x1 >= up.x0 - sp * 0.8 && lo.x0 <= up.x1 + sp * 0.8);
      if (!lowParts.length) continue;
      const upParts = uppers.filter((u) => u.x1 >= Math.min(...lowParts.map((l) => l.x0)) - sp * 0.3 && u.x0 <= Math.max(...lowParts.map((l) => l.x1)) + sp * 0.3).sort((a, b) => a.x0 - b.x0);
      if (upParts[0] !== up) continue; // her ölçü işareti bir kez
      const ups = upParts.map((c, i) => classify(c, upParts.length > 1 && i === 0 ? [1] : UPPER));
      const lows = lowParts.sort((a, b) => a.x0 - b.x0).map((c) => classify(c, LOWER));
      if ([...ups, ...lows].some((d) => d.score > 0.36 || d.digit === 'C')) continue;
      const num = Number(ups.map((d) => d.digit).join(''));
      const den = Number(lows.map((d) => d.digit).join(''));
      if (!num || num > 16 || !DEN.includes(den)) continue;
      const parts = [...upParts, ...lowParts];
      meters.push({ x0: Math.min(...parts.map((c) => c.x0)), x1: Math.max(...parts.map((c) => c.x1)), time: `${num}/${den}`, comps: parts });
      for (const c of parts) used.add(c.id);
    }
    // Porte çizgisi silinince orta çizgiye değen iki rakam tek şekil olarak kalabilir: ortadan böl.
    for (const c of staffComps) {
      if (used.has(c.id) || c.x0 < headerEnd - sp * 0.5 || meters.some((m) => c.x0 <= m.x1 && c.x1 >= m.x0)) continue;
      const ch = (c.y1 - c.y0 + 1) / sp;
      const cw = (c.x1 - c.x0 + 1) / sp;
      if (ch < 3.3 || ch > 4.7 || cw < 0.7 || cw > 2.6 || Math.abs(posOf((c.y0 + c.y1) / 2) - 4) > 0.7) continue;
      const top = subBox(labels, w, c, c.y0, staff.mid - sp * 0.12);
      const bottom = subBox(labels, w, c, staff.mid + sp * 0.12, c.y1);
      if (!top || !bottom || (top.y1 - top.y0) / sp < 1.3 || (bottom.y1 - bottom.y0) / sp < 1.3) continue;
      const a = classify(top, UPPER);
      const b = classify(bottom, LOWER);
      if (a.score > 0.36 || b.score > 0.36 || a.digit === 'C' || b.digit === 'C' || !DEN.includes(b.digit) || !a.digit) continue;
      meters.push({ x0: c.x0, x1: c.x1, time: `${a.digit}/${b.digit}`, comps: [c] });
      used.add(c.id);
    }
    for (const c of staffComps) {
      if (used.has(c.id) || c.x0 < headerEnd - sp * 0.5) continue;
      const ch = (c.y1 - c.y0 + 1) / sp;
      const cw = (c.x1 - c.x0 + 1) / sp;
      const center = posOf((c.y0 + c.y1) / 2);
      if (ch < 1.6 || ch > 3.4 || cw < 0.6 || cw > 2.2 || Math.abs(center - 4) > 0.8) continue;
      const d = classify(c);
      if (d.digit !== 'C' || d.score > 0.3) continue;
      // C şekli: ortadaki satırlarda solda mürekkep, ortası boş
      const cyc = Math.round((c.y0 + c.y1) / 2);
      const span = c.x1 - c.x0 + 1;
      let leftInk = 0;
      let midInk = 0;
      let rows = 0;
      for (let y = cyc - Math.round(sp * 0.2); y <= cyc + Math.round(sp * 0.2); y += 1) {
        rows += 1;
        for (let x = c.x0; x < c.x0 + span * 0.3; x += 1) if (labels[y * w + x] === c.id) { leftInk += 1; break; }
        for (let x = Math.round(c.x0 + span * 0.4); x < c.x0 + span * 0.75; x += 1) if (labels[y * w + x] === c.id) { midInk += 1; break; }
      }
      if (leftInk < rows * 0.8 || midInk > rows * 0.3) continue;
      const cut = verticalStrokes(labels, w, c, sp * 2.6).length > 0;
      meters.push({ x0: c.x0, x1: c.x1, time: cut ? '2/2' : '4/4', comps: [c] });
      used.add(c.id);
    }
    meters.sort((a, b) => a.x0 - b.x0);
  }
  const inMeter = (x0, x1) => meters.some((m) => x1 >= m.x0 - 2 && x0 <= m.x1 + 2);

  // 3) Nota başları
  const heads = [];
  for (const blob of ctx.headBlobs) {
    if (blob.cy < staff.top - 4.5 * sp || blob.cy > staff.bottom + 4.5 * sp) continue;
    if (blob.cx < headerEnd + sp * 0.3 || blob.cx > staff.x1) continue;
    // bu porteye mi ait? (en yakın porte)
    if (blob.staff !== staff.index) continue;
    if (inMeter(blob.x0, blob.x1)) continue;
    const pos = Math.round(posOf(blob.cy));
    // porte dışındaki notalarda ek çizgi olmalı (yazıları nota sanmamak için)
    if (pos <= -2 || pos >= 10) {
      const ledgerPos = pos <= -2 ? -2 : 10;
      const ly = yOfPos(ledgerPos);
      let found = false;
      for (let y = Math.round(ly - sp * 0.35); y <= Math.round(ly + sp * 0.35) && !found; y += 1) {
        let run = 0;
        for (let x = Math.round(blob.x0 - sp * 0.6); x <= Math.round(blob.x1 + sp * 0.6); x += 1) {
          run = bin[y * w + x] ? run + 1 : 0;
          if (run >= (blob.x1 - blob.x0) + sp * 0.35) {
            found = true;
            break;
          }
        }
      }
      if (!found) continue;
    }
    heads.push({ ...blob, pos });
  }
  // Süsleme notaları (küçük baş) ezgiye girmez
  const solidHeads = heads.filter((hd) => !hd.hollow);
  if (solidHeads.length >= 3) {
    const areas = solidHeads.map((hd) => hd.w * hd.h).sort((a, b) => a - b);
    const median = areas[Math.floor(areas.length / 2)];
    for (let i = heads.length - 1; i >= 0; i -= 1) if (!heads[i].hollow && heads[i].w * heads[i].h < median * 0.62) heads.splice(i, 1);
  }

  // 2) Ölçü çizgileri: porteyi baştan sona kesen ince dikey çizgiler
  const bars = [];
  {
    let run = null;
    const top = Math.round(staff.top);
    const bottom = Math.round(staff.bottom);
    for (let x = Math.round(headerEnd); x <= staff.x1; x += 1) {
      let full = true;
      let misses = 0;
      for (let y = top; y <= bottom; y += 1) {
        if (!lineBin[y * w + x]) {
          misses += 1;
          if (misses > 1) {
            full = false;
            break;
          }
        }
      }
      if (full) {
        if (run && x - run.x1 <= 1) run.x1 = x;
        else {
          if (run) bars.push(run);
          run = { x0: x, x1: x };
        }
      }
    }
    if (run) bars.push(run);
  }
  // Sapları ölçü çizgisi sanma: nota başına bitişik dikey çizgiler ölçü çizgisi değildir.
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const bar = bars[i];
    const nearHead = heads.some((b) => (Math.abs(bar.x0 - b.x1) < sp * 0.45 || Math.abs(bar.x1 - b.x0) < sp * 0.45 || (bar.x0 > b.x0 && bar.x1 < b.x1)));
    if (nearHead || bar.x1 - bar.x0 > sp * 0.9) bars.splice(i, 1);
  }
  // yan yana çift çizgiler (bitiş, tekrar) tek ölçü çizgisi sayılır
  for (let i = bars.length - 1; i > 0; i -= 1) {
    if (bars[i].x0 - bars[i - 1].x1 < sp * 1.2) {
      bars[i - 1].x1 = bars[i].x1;
      bars.splice(i, 1);
    }
  }


  // 4) Saplar ve süreler
  for (const head of heads) {
    const cy = Math.round(head.cy);
    const measureStem = (xFrom, xTo, dir) => {
      let best = { len: 0, x: 0, tip: cy };
      for (let x = Math.round(xFrom); x <= Math.round(xTo); x += 1) {
        let y = cy;
        let gaps = 0;
        let tip = cy;
        while (y > 0 && y < h - 1) {
          // açık gri ince saplar da görünsün diye hassas eşikli görüntüde izlenir
          if (lineBin[y * w + x]) {
            tip = y;
            gaps = 0;
          } else {
            gaps += 1;
            if (gaps > 1) break;
          }
          y += dir;
        }
        const len = Math.abs(tip - cy);
        if (len > best.len) best = { len, x, tip };
      }
      return best;
    };
    const up = measureStem(head.x1 - sp * 0.35, head.x1 + sp * 0.2, -1);
    const down = measureStem(head.x0 - sp * 0.2, head.x0 + sp * 0.35, 1);
    const stem = up.len >= down.len ? { ...up, dir: -1 } : { ...down, dir: 1 };
    head.stem = stem.len >= sp * 2.2 ? stem : null;
    let flags = 0;
    if (head.stem) {
      // Kirişler / bayraklar: sapın yanındaki sütunlarda, uçtan başlayarak kalın yatay koşular
      const scan = Math.min(sp * 1.9, head.stem.len - sp * 0.9);
      const minBeam = sp * 0.28;
      for (const side of [-1, 1]) {
        let best = 0;
        for (const off of [0.45, 0.65]) {
          const x = Math.round(head.stem.x + side * sp * off);
          let count = 0;
          let run = 0;
          const start = head.stem.tip + head.stem.dir * sp * 0.3;
          for (let k = 0; k <= scan + sp * 0.3; k += 1) {
            const y = Math.round(start - head.stem.dir * k);
            if (noStaff[y * w + x]) run += 1;
            else {
              if (run >= minBeam) count += 1;
              run = 0;
            }
          }
          if (run >= minBeam) count += 1;
          best = Math.max(best, count);
        }
        flags = Math.max(flags, best);
      }
      flags = Math.min(flags, 3);
    }
    head.flags = flags;
    // Birlik nota geniştir; dar, sapsız boş "baş" (ör. üçleme 3'ünün ilmeği) nota değildir.
    if (head.hollow) head.dur = head.stem ? 2 : head.headWidth >= 1.35 ? 1 : 0;
    else head.dur = head.stem ? 4 * 2 ** flags : 0;
    head.comp = labels[cy * w + Math.round(head.cx)] || 0;
    // boş baş: bileşeni yeterince büyük olmalı (saplıysa sap boyu; sapsızsa geniş birlik nota)
    if (head.hollow && head.split) {
      for (let y = Math.round(head.y0); y <= Math.round(head.y1); y += 1) {
        for (let x = Math.round(head.x0); x <= Math.round(head.x1); x += 1) {
          const id = labels[y * w + x];
          if (id && comps[id - 1].y1 - comps[id - 1].y0 < sp * 5) used.add(id);
        }
      }
    }
    if (head.hollow && !head.split) {
      // Halka porte çizgisi silinirken parçalanmış olabilir: başın kutusuna değen bütün parçaların birleşimi
      const ids = new Set();
      for (let y = Math.round(head.y0); y <= Math.round(head.y1); y += 1) {
        for (let x = Math.round(head.x0); x <= Math.round(head.x1); x += 1) if (labels[y * w + x]) ids.add(labels[y * w + x]);
      }
      const parts = [...ids].map((id) => comps[id - 1]).filter((c) => (c.y1 - c.y0) < sp * 8 && (c.x1 - c.x0) < sp * 6);
      if (parts.length) {
        const box = { x0: Math.min(...parts.map((c) => c.x0)), x1: Math.max(...parts.map((c) => c.x1)), y0: Math.min(...parts.map((c) => c.y0)), y1: Math.max(...parts.map((c) => c.y1)) };
        const ch = (box.y1 - box.y0 + 1) / sp;
        const cw = (box.x1 - box.x0 + 1) / sp;
        if (head.stem ? ch < 2.4 || cw > 2.4 : cw < 1.3 || cw > 2.6 || ch > 1.6) head.dur = 0;
        for (const c of parts) if (head.dur) used.add(c.id);
      } else head.dur = 0;
    }
    if (head.comp && head.dur) used.add(head.comp);
  }
  // sapsız dolu baş: nota değil (ya da okunamadı)
  const notes = heads.filter((head) => head.dur);

  // Aynı saptaki baslar (akor): en üstteki kalır
  notes.sort((a, b) => a.cx - b.cx);
  const melody = [];
  for (const note of notes) {
    const prev = melody[melody.length - 1];
    if (prev && Math.abs(prev.cx - note.cx) < sp * 0.9 && prev.stem && note.stem && Math.abs(prev.stem.x - note.stem.x) < sp * 0.5) {
      if (note.pos > prev.pos) melody[melody.length - 1] = { ...note, dur: prev.dur, dots: prev.dots };
      continue;
    }
    if (prev && Math.abs(prev.cx - note.cx) < sp * 0.4 && Boolean(prev.stem) === Boolean(note.stem)) {
      if (note.pos > prev.pos) melody[melody.length - 1] = note;
      continue;
    }
    melody.push(note);
  }

  // 5) Kalan şekiller: değiştirici işaretleri, noktalar, suslar, ölçü işareti, üçleme "3"
  const rest = staffComps.filter((c) => !used.has(c.id) && c.x0 > headerEnd - sp * 0.2);
  const accidentals = [];
  const dots = [];
  const rests = [];
  const digits = [];
  const others = [];
  for (const c of rest) {
    const cw = (c.x1 - c.x0 + 1) / sp;
    const ch = (c.y1 - c.y0 + 1) / sp;
    const cyPos = posOf((c.y0 + c.y1) / 2);
    // ölçü çizgisi parçası mı?
    if (bars.some((b) => c.x0 >= b.x0 - 2 && c.x1 <= b.x1 + 2)) continue;
    // nokta
    if (cw >= 0.2 && cw <= 0.65 && ch >= 0.2 && ch <= 0.65 && Math.abs(cw - ch) < 0.25 && compFill(labels, w, c) > 0.55) {
      dots.push({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, c });
      continue;
    }
    // değiştirici işaretleri (dikey çizgileri olan, 1.8–3.4 sp boyunda)
    if (ch >= 1.6 && ch <= 3.6 && cw >= 0.45 && cw <= 1.5) {
      const strokes = verticalStrokes(labels, w, c, sp * 1.3);
      if (strokes.length >= 2 && cw >= 0.6) {
        const [left, right] = [strokes[0], strokes[strokes.length - 1]];
        const natural = left.bottom < c.y1 - sp * 0.45 && right.top > c.y0 + sp * 0.45;
        accidentals.push({ type: natural ? 0 : 1, x0: c.x0, x1: c.x1, anchor: (c.y0 + c.y1) / 2, c });
        continue;
      }
      if (strokes.length === 1 && strokes[0].x0 - c.x0 < cw * sp * 0.35 && strokes[0].len >= ch * sp * 0.7) {
        // bemol: solda uzun çizgi, altta sağa doğru kıvrım
        const lowerRightBlack = (() => {
          let n = 0;
          for (let y = Math.round(c.y1 - sp * 0.8); y <= c.y1; y += 1) {
            for (let x = strokes[0].x1 + 2; x <= c.x1; x += 1) if (labels[y * w + x] === c.id) n += 1;
          }
          return n;
        })();
        if (lowerRightBlack > sp * sp * 0.08) {
          accidentals.push({ type: -1, x0: c.x0, x1: c.x1, anchor: c.y1 - sp * 0.5, c });
          continue;
        }
      }
    }
    // suslar
    if (cyPos > 1.5 && cyPos < 7) {
      const fill = compFill(labels, w, c);
      if (ch >= 0.3 && ch <= 0.8 && cw >= 0.75 && cw <= 1.8 && fill > 0.7) {
        rests.push({ x: (c.x0 + c.x1) / 2, x0: c.x0, x1: c.x1, dur: cyPos > 5 ? 1 : 2, block: true, c });
        continue;
      }
      // en uzun dikey koşu: değiştirici işaretlerinde boyun çoğu kadar, susların zikzakında kısa
      const allStrokes = verticalStrokes(labels, w, c, 1);
      const longestStroke = allStrokes.reduce((m, st) => (!m || st.len > m.len ? st : m), null);
      const longest = longestStroke ? longestStroke.len / sp : 0;
      // bemolün uzun çizgisi sol kenarda; çeyrek susun dikeye yakın kısmı ortada
      const strokeCentered = longestStroke && longestStroke.x0 - c.x0 > (c.x1 - c.x0) * 0.25;
      // satır genişlikleri: sekizlik susun üstünde kalın bir leke, altında ince bir çizgi var
      const rowWidths = [];
      for (let y = c.y0; y <= c.y1; y += 1) {
        let n = 0;
        for (let x = c.x0; x <= c.x1; x += 1) if (labels[y * w + x] === c.id) n += 1;
        rowWidths.push(n);
      }
      const topRows = rowWidths.slice(0, Math.max(1, Math.round(rowWidths.length * 0.4)));
      const lowRows = rowWidths.slice(Math.round(rowWidths.length * 0.55)).sort((a, b) => a - b);
      const topMax = Math.max(...topRows);
      const lowMed = lowRows.length ? lowRows[Math.floor(lowRows.length / 2)] : topMax;
      const blobTop = topMax >= sp * 0.5 && topMax >= lowMed * 1.6;
      if (blobTop && ch >= 1.1 && ch < 2.4 && cw >= 0.5 && cw <= 1.4 && fill > 0.2 && fill < 0.65) {
        rests.push({ x: (c.x0 + c.x1) / 2, x0: c.x0, x1: c.x1, dur: 8, c });
        continue;
      }
      if (ch >= 2.35 && ch <= 3.6 && cw >= 0.55 && cw <= 1.5 && (longest < ch * 0.87 || strokeCentered || topMax >= sp * 0.45) && fill > 0.25 && fill < 0.7 && cyPos > 2.5 && cyPos < 5.5) {
        rests.push({ x: (c.x0 + c.x1) / 2, x0: c.x0, x1: c.x1, dur: 4, c });
        continue;
      }
    }
    // rakamlar (ölçü işareti ya da üçleme)
    if (ch >= 0.7 && ch <= 2.6 && cw >= 0.35 && cw <= 2.2) digits.push(c);
    else others.push(c);
  }

  // 6) Değiştirici işaretlerini notalara bağla; donanımı bul (ilk notadan önceki işaretler)
  const firstNoteX = melody.length ? melody[0].x0 : staff.x1;
  const keyAccidentals = accidentals.filter((a) => a.x1 < firstNoteX - sp * 0.3 && a.x0 < headerEnd + sp * 6 && !melody.some((n) => n.x0 > a.x1 && n.x0 - a.x1 < sp * 1.2 && Math.abs(n.cy - a.anchor) < sp * 0.6));
  let fifths = fifthsGuess;
  // Donanım işaretleri belli yüksekliklerde durur: sol anahtarında diyezler fa5 (pos 8) do5 sol5 …,
  // bemoller si4 (pos 4) mi5 la4 …; fa anahtarında iki basamak aşağı. Uymayan şekiller donanım sayılmaz.
  const SHARP_POS = [8, 5, 9, 6, 3, 7, 4];
  const FLAT_POS = [4, 7, 3, 6, 2, 5, 1];
  const clefShiftPos = clef === 'bass' ? -2 : 0;
  const keySorted = [...keyAccidentals].sort((a, b) => a.x0 - b.x0);
  let keyCount = 0;
  const keyType = keySorted[0]?.type;
  if (keyType === 1 || keyType === -1) {
    const table = keyType === 1 ? SHARP_POS : FLAT_POS;
    for (const a of keySorted) {
      if (a.type !== keyType || keyCount >= 7) break;
      const p = Math.round(posOf(a.anchor));
      if (Math.abs(p - (table[keyCount] + clefShiftPos)) > 1) break;
      keyCount += 1;
    }
  }
  if (keyCount) {
    fifths = keyType * keyCount;
    headerEnd = Math.max(headerEnd, ...keySorted.slice(0, keyCount).map((a) => a.x1));
  } else if (clefComp) fifths = 0;
  for (const note of melody) {
    const acc = accidentals
      .filter((a) => !keyAccidentals.includes(a) && a.x1 <= note.x0 + sp * 0.15 && note.x0 - a.x1 < sp * 1.6 && Math.abs(a.anchor - note.cy) < sp * 0.6)
      .sort((a, b) => b.x1 - a.x1)[0];
    if (acc) note.accidental = acc.type;
  }

  // 7) Noktalar (uzatma noktası: notanın sağında, aynı yükseklikte ya da bir aralık yukarıda)
  const attachDot = (item, x1, cy) => {
    const dot = dots.find((d) => d.x > x1 + sp * 0.05 && d.x < x1 + sp * 1.4 && d.y > cy - sp * 0.95 && d.y < cy + sp * 0.6 && !d.taken);
    if (dot) {
      dot.taken = true;
      item.dots = 1;
    }
  };
  for (const note of melody) attachDot(note, note.stem && note.stem.dir === -1 ? Math.max(note.x1, note.stem.x) : note.x1, note.cy);
  // susun yanındaki "nokta" çoğu zaman bir sonraki sekizlik susun kopmuş başıdır
  for (const d of dots) {
    if (rests.some((r) => d.x > r.c.x0 - sp * 0.5 && d.x < r.c.x1 + sp * 0.5 && d.y > r.c.y0 - sp * 0.5 && d.y < r.c.y1 + sp * 0.5)) d.taken = true;
  }
  for (const r of rests) attachDot(r, r.x1, (r.c.y0 + r.c.y1) / 2);

  const digitInfo = digits.map((c) => ({ c, ...classifyDigit(sampleGrid(labels, w, c), (c.x1 - c.x0 + 1) / (c.y1 - c.y0 + 1)) }));
  for (const m of meters) if (m.x0 < firstNoteX && m.x0 < headerEnd + sp * 8) headerEnd = Math.max(headerEnd, m.x1);

  // 9) Üçlemeler: "3" rakamı (porte dışında, kirişin üstünde ya da altında)
  const triplets = digitInfo.filter((d) => !d.taken && d.digit === 3 && d.score < 0.36 && (d.c.y1 - d.c.y0) / sp < 1.8);

  return { clef, fifths, bars, melody, rests: rests.filter((r) => r.x0 > headerEnd), meters, triplets, headerEnd, staff, digitInfo, others, accidentals, dots };
}

// --- Ölçülere dizme --------------------------------------------------------------------

const REPRESENTABLE = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125]; // dörtlük cinsinden

function splitQuarters(q) {
  const out = [];
  let left = q;
  while (left > 0.1) {
    const v = REPRESENTABLE.find((r) => r <= left + 1e-6);
    if (!v) break;
    const base = [4, 2, 1, 0.5, 0.25, 0.125].find((b) => Math.abs(b - v) < 1e-6 || Math.abs(b * 1.5 - v) < 1e-6);
    out.push({ dur: 4 / base, dots: Math.abs(base - v) < 1e-6 ? 0 : 1 });
    left -= v;
  }
  return out;
}

function noteLength(item) {
  const base = 4 / item.dur;
  return base * (item.dots ? 1.5 : 1) * (item.tup ? 2 / 3 : 1);
}

function assemble(staffResults, startTime) {
  const measures = [];
  let time = startTime;
  let firstMeasureTime = null;
  for (const res of staffResults) {
    const { staff } = res;
    const sp = staff.sp;
    const events = [];
    for (const n of res.melody) events.push({ kind: 'note', x: n.cx, n });
    for (const r of res.rests) events.push({ kind: 'rest', x: r.x, r });
    for (const b of res.bars) events.push({ kind: 'bar', x: (b.x0 + b.x1) / 2 });
    for (const m of res.meters) events.push({ kind: 'meter', x: m.x0, time: m.time });
    events.sort((a, b) => a.x - b.x);
    // üçlemeler: "3" rakamının altındaki/üstündeki en yakın üç nota
    const noteEvents = events.filter((e) => e.kind === 'note');
    for (const t of res.triplets) {
      const tx = (t.c.x0 + t.c.x1) / 2;
      const sorted = noteEvents.map((e, i) => ({ i, d: Math.abs(e.x - tx) })).sort((a, b) => a.d - b.d);
      if (!sorted.length || sorted[0].d > sp * 2.5) continue;
      const mid = sorted[0].i;
      let group = [mid - 1, mid, mid + 1];
      if (group[0] < 0) group = [0, 1, 2];
      if (group[2] >= noteEvents.length) group = group.map((g) => g - (group[2] - noteEvents.length + 1));
      // en yakın üçlü: ortadaki notanın iki yanından, 3'e daha yakın olan pencere
      const windows = [[mid - 2, mid - 1, mid], [mid - 1, mid, mid + 1], [mid, mid + 1, mid + 2]]
        .filter((g) => g[0] >= 0 && g[2] < noteEvents.length)
        .map((g) => ({ g, d: Math.abs((noteEvents[g[0]].x + noteEvents[g[2]].x) / 2 - tx) }))
        .sort((a, b) => a.d - b.d);
      if (windows.length) group = windows[0].g;
      const ns = group.map((i) => noteEvents[i].n);
      if (ns.some((n) => n.tup)) continue;
      const between = events.some((e) => e.kind === 'bar' && e.x > ns[0].cx && e.x < ns[2].cx);
      if (between) continue;
      ns.forEach((n, k) => {
        n.tup = 3;
        n.tupPos = k;
      });
    }

    let current = [];
    let pendingMeter = null;
    const close = () => {
      if (current.length) measures.push(current);
      current = [];
    };
    for (const e of events) {
      if (e.kind === 'bar') {
        close();
        continue;
      }
      if (e.kind === 'meter') {
        if (e.time !== time) {
          if (measures.length || current.length) pendingMeter = e.time;
          else firstMeasureTime = e.time;
          time = e.time;
        }
        continue;
      }
      let item;
      if (e.kind === 'note') {
        const n = e.n;
        item = { step: 0, alter: 0, octave: 4, dur: n.dur, dots: n.dots ?? 0, pos: n.pos, accidental: n.accidental, clef: res.clef, fifths: res.fifths };
        if (n.tup) {
          item.tup = 3;
          item.tupPos = n.tupPos;
        }
      } else {
        const r = e.r;
        if (r.block && r.dur === 1) item = { rest: true, dur: 1, dots: 0, whole: true };
        else item = { rest: true, dur: r.dur, dots: r.dots ?? 0 };
      }
      if (pendingMeter && !current.length) {
        item.meter = pendingMeter;
        pendingMeter = null;
      }
      current.push(item);
    }
    close();
  }
  return { measures, time: firstMeasureTime ?? startTime };
}

const SIGN_ORDER_SHARP = [3, 0, 4, 1, 5, 2, 6];
const SIGN_ORDER_FLAT = [6, 2, 5, 1, 4, 0, 3];
function keyAlter(fifths, step) {
  if (fifths > 0 && SIGN_ORDER_SHARP.slice(0, fifths).includes(step)) return 1;
  if (fifths < 0 && SIGN_ORDER_FLAT.slice(0, -fifths).includes(step)) return -1;
  return 0;
}

/** Konumları (pos) ve işaretleri gerçek seslere çevirir; ölçüdeki işaretler ölçü sonuna kadar geçerli. */
function resolvePitches(measures, fifths, time) {
  let meter = time;
  const [num, den] = time.split('/').map(Number);
  let length = (num * 4) / den;
  for (const measure of measures) {
    if (measure[0]?.meter) {
      meter = measure[0].meter;
      const [a, b] = meter.split('/').map(Number);
      length = (a * 4) / b;
    }
    // Üçleme sanılan bir "3" ölçüyü bozuyorsa (üçlemesiz ölçü tam tutuyor) üçlemeyi kaldır
    if (measure.some((item) => item.tup)) {
      const withTup = measure.reduce((sum, item) => sum + noteLength(item), 0);
      const without = measure.reduce((sum, item) => sum + noteLength({ ...item, tup: undefined }), 0);
      if (Math.abs(without - length) < 1e-6 && Math.abs(withTup - length) > 1e-6) {
        for (const item of measure) {
          delete item.tup;
          delete item.tupPos;
        }
      }
    }
    const carried = new Map();
    for (let i = 0; i < measure.length; i += 1) {
      const item = measure[i];
      if (item.rest) {
        if (item.whole && measure.length === 1 && Math.abs(length - 4) > 1e-6) {
          const parts = splitQuarters(length).map((p) => ({ rest: true, ...p }));
          if (item.meter) parts[0].meter = item.meter;
          measure.splice(i, 1, ...parts);
          i += parts.length - 1;
        }
        delete measure[i].whole;
        continue;
      }
      const dia = DIATONIC_BOTTOM[item.clef] + item.pos;
      const octave = Math.floor(dia / 7);
      const step = dia - octave * 7;
      const slot = dia;
      let alter;
      if (item.accidental !== undefined) {
        alter = item.accidental;
        carried.set(slot, alter);
      } else alter = carried.has(slot) ? carried.get(slot) : keyAlter(fifths, step);
      const out = { step, alter, octave, dur: item.dur, dots: item.dots };
      if (item.tup) {
        out.tup = item.tup;
        out.tupPos = item.tupPos;
      }
      if (item.meter) out.meter = item.meter;
      measure[i] = out;
    }
  }
  return measures;
}

/**
 * Ölçü işareti okunamadıysa ölçülerin çoğunun süresinden tahmin eder.
 */
function guessTime(measures) {
  const counts = new Map();
  for (const m of measures.slice(1, -1)) {
    const total = m.reduce((s, item) => s + noteLength(item), 0);
    const key = Math.round(total * 8) / 8;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [common] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [4];
  const sixEight = measures.flat().filter((i) => i.dots && i.dur === 4).length > measures.length * 0.5;
  const table = { 1: '2/4', 1.5: '3/8', 2: '2/4', 3: sixEight ? '6/8' : '3/4', 4: '4/4', 2.5: '5/8', 3.5: '7/8', 4.5: '9/8', 6: '12/8' };
  return table[common] ?? '4/4';
}

/**
 * Gri tonlu görüntüden notaları okur.
 * image: { width, height, data: Uint8Array (0 siyah … 255 beyaz) }
 * Sonuç (abc.js parseAbc ile aynı biçim): { title, composer, key, fifths, clef, time, measures, warnings, explicitMode, debug? }
 */
export function readScoreBitmap(image, { debug = false } = {}) {
  let w = image.width;
  let h = image.height;
  // Fotoğraf: ışığı eşitle, eğikse düzelt
  let gray = flattenIllumination(image.data, w, h);
  const angle = skewAngle(binarize(gray, 200), w, h);
  if (Math.abs(angle) >= 0.1) gray = rotate(gray, w, h, angle);
  // Küçük görüntülerde porte çizgileri açık gri olur: aralığı ölçerken hassas eşik kullan.
  let bin = binarize(gray, 225);
  let { lt, sp } = runStats(bin, w, h);
  if (sp < 4 || sp > 120) return { ...emptyResult(), warnings: ['no-staff'], debug: debug ? { sp, lt } : undefined };
  const scale = TARGET_SP / sp;
  if (scale < 0.8 || scale > 1.25) {
    ({ gray, w, h } = resample(gray, w, h, scale));
    ({ lt, sp } = runStats(binarize(gray, 225), w, h));
  }
  // Porte çizgileri açık gri olabilir: onları hassas eşikle ayrıca bul.
  // Şekiller için daha koyu eşik: büyütülmüş küçük görüntülerde bulanık kenarlar kalınlaşmasın.
  bin = binarize(gray, scale > 1.6 ? 175 : null);
  const lineBin = binarize(gray, 225);
  const staves = findStaves(lineBin, w, h, lt, sp);
  if (!staves.length) return { ...emptyResult(), warnings: ['no-staff'], debug: debug ? { angle, sp, lt, w, h, staves } : undefined };
  staves.forEach((s, i) => {
    s.index = i;
  });
  // Piyano: birbirine bağlı porteler (sol baştaki çizgi ya da ölçü çizgisi ikisini de keser)
  for (let i = 0; i + 1 < staves.length; i += 1) {
    const a = staves[i];
    const b = staves[i + 1];
    if (b.top - a.bottom > a.sp * 12) continue;
    let joined = false;
    for (let x = Math.min(a.x0, b.x0) - 2; x <= Math.min(a.x0, b.x0) + a.sp * 0.6 && !joined; x += 1) {
      let full = true;
      for (let y = Math.round(a.bottom); y <= Math.round(b.top); y += 1) if (!lineBin[y * w + x]) { full = false; break; }
      if (full) joined = true;
    }
    if (joined) b.lower = true;
  }
  // Çizgi bantlarını şekil eşiğiyle yeniden ölç (hassas eşikte çizgiler kalın görünür;
  // geniş bant silinirse çizgiye değen kirişler ve baş kenarları da silinir).
  let ltSum = 0;
  let ltN = 0;
  for (const staff of staves) {
    for (const line of staff.lines) {
      const need = (staff.x1 - staff.x0) * 0.5;
      let a = null;
      let b = null;
      for (let y = line.a - 1; y <= line.b + 1; y += 1) {
        let n = 0;
        for (let x = staff.x0; x <= staff.x1; x += 1) n += bin[y * w + x];
        if (n >= need) {
          if (a === null) a = y;
          b = y;
        }
      }
      if (a !== null) {
        line.a = a;
        line.b = b;
        ltSum += b - a + 1;
        ltN += 1;
      }
    }
  }
  const ltShape = ltN ? ltSum / ltN : lt;
  const noStaff = removeStaffLines(bin, w, h, staves, ltShape);
  const { labels, comps } = components(noStaff, w, h);
  // Boş nota başlarının içi doldurulur. Porte çizgisi başın kenarını incelttiyse çizgisiz
  // görüntüde boşluk açık kalır; bu yüzden çizgili görüntüdeki küçük boşluklar da doldurulur.
  const filled = fillHoles(noStaff, w, h, Math.round(sp * sp * 0.6), sp * 1.4, sp * 0.85);
  const holesWithLines = fillHoles(bin, w, h, Math.round(sp * sp * 0.45), sp * 1.4, sp * 0.7);
  for (let i = 0; i < filled.length; i += 1) if (holesWithLines[i] && !bin[i]) filled[i] = 1;
  // çizgili görüntüde dolan bir başın içinden geçen porte çizgisi parçası da başa aittir
  for (const staff of staves) {
    for (const line of staff.lines) {
      for (let x = staff.x0; x <= staff.x1; x += 1) {
        const above = line.a - 1;
        const below = line.b + 1;
        if (above < 0 || below >= h) continue;
        if (filled[above * w + x] && filled[below * w + x]) for (let y = line.a; y <= line.b; y += 1) filled[y * w + x] = 1;
      }
      // çizgi satırında baş içinde kalan kısa boşlukları kapat
      const gapMax = Math.round(sp * 0.45);
      for (let y = line.a; y <= line.b; y += 1) {
        let last = -1;
        for (let x = staff.x0; x <= staff.x1; x += 1) {
          if (!filled[y * w + x]) continue;
          if (last >= 0 && x - last > 1 && x - last <= gapMax) for (let k = last + 1; k < x; k += 1) filled[y * w + k] = 1;
          last = x;
        }
      }
    }
  }
  const k = Math.max(3, Math.round(sp * 0.56));
  const openedFilled = opening(filled, w, h, k, k);
  const { labels: blobLabels, comps: blobComps } = components(openedFilled, w, h);
  // baş adayları
  const headBlobs = [];
  const ringSides = []; // kalın halkalı boş başların iki yanı (ortası açık kalmışsa)
  for (const b of blobComps) {
    const bw = (b.x1 - b.x0 + 1) / sp;
    const bh = (b.y1 - b.y0 + 1) / sp;
    if (bw >= 0.3 && bw < 0.85 && bh >= 0.6 && bh <= 1.3) ringSides.push(b);
    if (bw < 0.85 || bw > 2.3 || bh < 0.6 || bh > 1.45) continue;
    let sx = 0;
    let sy = 0;
    let n = 0;
    let solid = 0;
    let holePixels = 0;
    for (let y = b.y0; y <= b.y1; y += 1) {
      for (let x = b.x0; x <= b.x1; x += 1) {
        const i = y * w + x;
        if (blobLabels[i] !== b.id) continue;
        n += 1;
        sx += x;
        sy += y;
        if (noStaff[i]) solid += 1;
        else if (filled[i]) holePixels += 1;
      }
    }
    const solidity = solid / n;
    const hollow = holePixels >= Math.max(4, n * 0.05);
    let headWidth = bw;
    if (hollow) {
      // Boş baş eğik bir elips: ortasındaki satırda genişliği, sütunda yüksekliğinden belirgin büyük.
      // ("o", "0" gibi yuvarlak yazılar elenir.)
      const cxr = Math.round(sx / n);
      const cyr = Math.round(sy / n);
      let left = cxr;
      let right = cxr;
      for (let yy = cyr - 2; yy <= cyr + 2; yy += 1) {
        let l = cxr;
        while (l > 0 && filled[yy * w + l - 1]) l -= 1;
        let r = cxr;
        while (r < w - 1 && filled[yy * w + r + 1]) r += 1;
        if (r - l > right - left) {
          left = l;
          right = r;
        }
      }
      let top = cyr;
      while (top > 0 && filled[(top - 1) * w + cxr]) top -= 1;
      let bottom = cyr;
      while (bottom < h - 1 && filled[(bottom + 1) * w + cxr]) bottom += 1;
      const rowW = (right - left + 1) / sp;
      const colH = (bottom - top + 1) / sp;
      if (rowW / colH < 1.12 || rowW < 1.0 || rowW > 2.4) continue;
      // Halka: ortadaki satırlarda solda ve sağda kalın kenar, arada boşluk olmalı
      // (kirişlerle saplar arasında kalan boşluklar ya da yay çizgileri baş sanılmasın).
      let ringOk = false;
      for (let yy = cyr - 2; yy <= cyr + 2 && !ringOk; yy += 1) {
        let l = left;
        while (l <= right && !filled[yy * w + l]) l += 1;
        let lr = 0;
        while (l + lr <= right && noStaff[yy * w + l + lr]) lr += 1;
        let r = right;
        while (r >= left && !filled[yy * w + r]) r -= 1;
        let rr = 0;
        while (r - rr >= left && noStaff[yy * w + r - rr]) rr += 1;
        const gap = r - rr - (l + lr) + 1;
        if (lr >= sp * 0.14 && rr >= sp * 0.14 && gap >= 1 && lr + rr + gap <= (right - left + 1) + 2) ringOk = true;
      }
      if (!ringOk) continue;
      headWidth = rowW;
    }
    if (!hollow && (solidity < 0.8 || bw > 1.75 || bh < 0.72)) continue; // dolu baş: kiriş parçası kadar geniş olamaz
    const cy = sy / n;
    // en yakın porte
    let best = null;
    for (const s of staves) {
      const d = cy < s.top ? s.top - cy : cy > s.bottom ? cy - s.bottom : 0;
      if (!best || d < best.d) best = { s, d };
    }
    headBlobs.push({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, cx: sx / n, cy, hollow, headWidth, staff: best.s.index, w: bw, h: bh });
  }
  // Aralığa tam oturan boş baş: halkanın üstü ve altı porte çizgisine karışır, çizgi silinince
  // halka açılır. Çizgili görüntüde ise içi (iki çizgi ve iki yan kenar arasında) kapalı bir
  // boşluktur: bu boşlukları ayrıca bul.
  {
    const inner = fillHoles(bin, w, h, Math.round(sp * sp * 1.0), sp * 1.25, sp * 1.0);
    const holeMask = new Uint8Array(w * h);
    for (let i = 0; i < holeMask.length; i += 1) holeMask[i] = inner[i] && !bin[i] ? 1 : 0;
    const { comps: holes } = components(holeMask, w, h);
    for (const hole of holes) {
      const hw = (hole.x1 - hole.x0 + 1) / sp;
      const hh = (hole.y1 - hole.y0 + 1) / sp;
      if (hw < 0.3 || hw > 1.25 || hh < 0.5 || hh > 1.0) continue;
      const cy = Math.round((hole.y0 + hole.y1) / 2);
      // bir porte aralığında mı?
      const staff = staves.find((st) => cy > st.top && cy < st.bottom);
      if (!staff) continue;
      const pos = (staff.bottom - cy) / (staff.sp / 2);
      if (Math.abs(pos - Math.round(pos)) > 0.35 || Math.round(pos) % 2 === 0) continue;
      if (headBlobs.some((b) => b.x0 <= hole.x1 && b.x1 >= hole.x0 && b.y0 <= hole.y1 && b.y1 >= hole.y0)) continue;
      // iki yanda kalın kenar
      let left = hole.x0;
      while (left > 0 && bin[cy * w + left - 1]) left -= 1;
      let right = hole.x1;
      while (right < w - 1 && bin[cy * w + right + 1]) right += 1;
      const lr = (hole.x0 - left) / sp;
      const rr = (right - hole.x1) / sp;
      const outer = (right - left + 1) / sp;
      if (lr < 0.18 || rr < 0.18 || outer < 1.05 || outer > 2.3) continue;
      // saplar dümdüz dikeydir; halkanın dış kenarı ise yukarı ve aşağı doğru içeri kıvrılır
      const edge = (y, dir) => {
        let x = dir < 0 ? hole.x0 : hole.x1;
        while (x > 0 && x < w - 1 && !bin[y * w + x]) x += dir;
        while (x > 0 && x < w - 1 && bin[y * w + x + dir]) x += dir;
        return x;
      };
      const dy = Math.round(sp * 0.3);
      const bendL = Math.abs(edge(cy - dy, -1) - edge(cy, -1)) + Math.abs(edge(cy + dy, -1) - edge(cy, -1));
      const bendR = Math.abs(edge(cy - dy, 1) - edge(cy, 1)) + Math.abs(edge(cy + dy, 1) - edge(cy, 1));
      if (bendL < sp * 0.15 || bendR < sp * 0.15) continue;
      // diyez/natürel gibi işaretlerin iç kenarı uzun dikey çizgidir; halkanın iç kenarı kısa
      const vrun = (x) => {
        let n = 0;
        for (let y = cy; y > 0 && bin[y * w + x]; y -= 1) n += 1;
        for (let y = cy + 1; y < h && bin[y * w + x]; y += 1) n += 1;
        return n / sp;
      };
      const innerL = Math.max(vrun(hole.x0 - 1), vrun(hole.x0 - 2));
      const innerR = Math.max(vrun(hole.x1 + 1), vrun(hole.x1 + 2));
      if (innerL > 1.3 || innerR > 1.3) continue;
      // kenarlar ince dikey çizgi (sap) değil, yuvarlak olmalı: halkanın dış kenarı yukarıda ve aşağıda içeri kıvrılır
      const rowWidth = (y) => {
        let l = hole.x0;
        while (l > left - 2 && !bin[y * w + l]) l -= 1;
        let a = l;
        while (a > 0 && bin[y * w + a - 1]) a -= 1;
        return l - a + 1;
      };
      const midW = rowWidth(cy);
      if (midW < sp * 0.12) continue;
      headBlobs.push({ x0: left, x1: right, y0: hole.y0 - Math.round(sp * 0.1), y1: hole.y1 + Math.round(sp * 0.1), cx: (left + right) / 2, cy, hollow: true, headWidth: outer, staff: staff.index, w: outer, h: hh + 0.2, split: true });
    }
  }
  // İki yan parça + aralarında boşluk = boş baş (ortası porte çizgisine açılmış birlik/ikilik nota)
  ringSides.sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < ringSides.length; i += 1) {
    const a = ringSides[i];
    for (let j = i + 1; j < ringSides.length; j += 1) {
      const b = ringSides[j];
      if (b.x0 - a.x1 > sp * 0.95) break;
      const gap = (b.x0 - a.x1 - 1) / sp;
      const ay = (a.y0 + a.y1) / 2;
      const by = (b.y0 + b.y1) / 2;
      const total = (b.x1 - a.x0 + 1) / sp;
      if (gap < 0.2 || Math.abs(ay - by) > sp * 0.3 || total < 1.3 || total > 2.4) continue;
      // arası (ortadaki satırlar) çoğunlukla boş olmalı
      const cy = Math.round((ay + by) / 2);
      let ink = 0;
      let n = 0;
      for (let y = cy - Math.round(sp * 0.15); y <= cy + Math.round(sp * 0.15); y += 1) {
        for (let x = a.x1 + 1; x < b.x0; x += 1) {
          n += 1;
          ink += noStaff[y * w + x];
        }
      }
      if (!n || ink / n > 0.25) continue;
      let best = null;
      for (const st of staves) {
        const d = cy < st.top ? st.top - cy : cy > st.bottom ? cy - st.bottom : 0;
        if (!best || d < best.d) best = { s: st, d };
      }
      headBlobs.push({ x0: a.x0, x1: b.x1, y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), cx: (a.x0 + b.x1) / 2, cy: (ay + by) / 2, hollow: true, headWidth: total, staff: best.s.index, w: total, h: Math.max(a.y1 - a.y0, b.y1 - b.y0) / sp, split: true });
      break;
    }
  }
  const ctx = { w, h, bin, lineBin, noStaff, labels, comps, sp, lt, headBlobs };
  const results = [];
  let fifths = 0;
  for (const staff of staves) {
    if (staff.lower) continue;
    const res = readStaff(ctx, staff, fifths);
    fifths = res.fifths;
    results.push(res);
  }
  const first = results[0];
  const startTime = first.meters.find((m) => m.x0 < (first.melody[0]?.x0 ?? Infinity))?.time ?? null;
  const { measures: raw, time: readTime } = assemble(results, startTime ?? '4/4');
  const keyFifths = first.fifths;
  let time = startTime ? readTime : guessTime(raw);
  const measures = resolvePitches(raw, keyFifths, time).filter((m) => m.length);
  const warnings = [];
  if (!startTime) warnings.push('time-guessed');
  const key = guessMode(measures, { ...majorTonicOf(keyFifths), mode: 'major' });
  const out = { title: '', composer: '', key, fifths: keyFifths, clef: first.clef, time, measures, warnings, explicitMode: false };
  if (debug) out.debug = { angle, sp, lt, scale: w / image.width, staves, results, headBlobs, width: w, height: h, images: { bin, noStaff, filled, openedFilled } };
  return out;
}

function emptyResult() {
  return { title: '', composer: '', key: { step: 0, alter: 0, mode: 'major' }, fifths: 0, clef: 'treble', time: '4/4', measures: [], explicitMode: false };
}

// Testler için iç adımlar
export const _internal = { skewAngle, flattenIllumination, binarize, resample, runStats, components, fillHoles, opening, findStaves, removeStaffLines };
