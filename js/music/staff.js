/**
 * Porte çizimi (SVG): sol ya da fa anahtarı, donanım, ölçü işareti, süreleriyle notalar (yuvarlak,
 * sap, bayrak, ışın, nokta), suslar, değişim işaretleri, ek çizgiler, ölçü çizgileri ve
 * istenirse notaların altında adları (do, re, mi…).
 *
 * Satırlar ekran genişliğine göre ölçü ölçü bölünür; genişlik değişince yeniden çizilir.
 * Bütün şekiller burada çizilir (yazı tipine bağlı müzik simgesi kullanılmaz), böylece her
 * telefonda aynı görünür.
 */
import { beats, diatonic, pitchLabel, signatureSteps, withAccidentals } from './notation.js';

// Fa anahtarında notalar, sol anahtarındaki yerlerine göre 12 basamak (bir oktav + üçlü) yukarıda
// çizilir; böylece çizim kodu tek bir porte düzenini kullanır.
let clefShift = 0;
const posOf = (item) => diatonic(item) + clefShift;

const SVG = 'http://www.w3.org/2000/svg';
const TOP_LINE = 38; // fa5: portenin en üst çizgisi (sol anahtarı)
const BOTTOM_LINE = 30; // mi4
const MIDDLE = 34; // si4
const SHARP_POS = { 3: 38, 0: 35, 4: 39, 1: 36, 5: 33, 2: 37, 6: 34 };
const FLAT_POS = { 6: 34, 2: 37, 5: 33, 1: 36, 4: 32, 0: 35, 3: 31 };
const WIDTH = { 1: 4.4, 2: 3.4, 4: 2.6, 8: 2.1, 16: 1.8, 32: 1.6 };

function node(tag, attrs = {}, parent = null) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  parent?.append(element);
  return element;
}

const flagCount = (dur) => ({ 8: 1, 16: 2, 32: 3 })[dur] ?? 0;

/** Işın grupları: ölçünün içinde, vuruş gruplarına göre (dörtlük cinsinden sınırlar). */
function beatGroups(time) {
  if (time.den === 8) {
    const split = { 5: [2, 3], 7: [2, 2, 3] }[time.num] ?? Array(Math.max(1, Math.round(time.num / 3))).fill(3);
    return split.map((eighths) => eighths / 2);
  }
  const beat = 4 / time.den;
  return Array(time.num).fill(beat);
}

/** Bir ölçünün öğelerini yatayda yerleştirir; genişliği ve x konumlarını döndürür. */
function measureLayout(measure, s) {
  let x = s * 1.1 + (measure[0]?.meter ? s * 2.4 : 0);
  const items = measure.map((item) => {
    const left = item.shown !== null && item.shown !== undefined ? s * 1.3 : 0;
    const width = WIDTH[item.dur] * s + left + (item.dots ? s * 0.7 : 0);
    const placed = { item, x: x + left, width };
    x += width;
    return placed;
  });
  return { items, width: x + s * 0.6 };
}

// --- Şekiller --------------------------------------------------------------------------

function trebleClef(g, x, yOf, s) {
  // Basit bir sol anahtarı: sol4 çizgisinin (pozisyon 32) çevresinde sarmal.
  const gy = yOf(32);
  const top = yOf(TOP_LINE) - s * 1.6;
  const bottom = yOf(BOTTOM_LINE) + s * 1.7;
  const cx = x + s * 1.3;
  const d = [
    `M ${cx + s * 0.15} ${gy + s * 0.15}`,
    `C ${cx + s * 0.9} ${gy + s * 0.2} ${cx + s * 0.85} ${gy - s * 1.05} ${cx} ${gy - s * 0.95}`,
    `C ${cx - s * 1.0} ${gy - s * 0.85} ${cx - s * 1.15} ${gy + s * 0.6} ${cx - s * 0.1} ${gy + s * 1.05}`,
    `C ${cx + s * 1.0} ${gy + s * 1.45} ${cx + s * 1.5} ${gy - s * 0.4} ${cx + s * 0.6} ${gy - s * 1.6}`,
    `C ${cx - s * 0.2} ${gy - s * 2.6} ${cx - s * 0.3} ${top + s * 1.4} ${cx + s * 0.1} ${top}`,
    `C ${cx + s * 0.6} ${top + s * 0.6} ${cx + s * 0.4} ${top + s * 1.6} ${cx - s * 0.1} ${gy - s * 2.2}`,
    `L ${cx + s * 0.25} ${bottom - s * 0.4}`,
    `C ${cx + s * 0.35} ${bottom + s * 0.2} ${cx - s * 0.6} ${bottom + s * 0.3} ${cx - s * 0.5} ${bottom - s * 0.4}`,
  ].join(' ');
  node('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': s * 0.22, 'stroke-linecap': 'round', class: 'staff-clef' }, g);
  node('circle', { cx: cx - s * 0.45, cy: bottom - s * 0.45, r: s * 0.32, fill: 'currentColor' }, g);
}

function bassClef(g, x, yOf, s) {
  const cx = x + s * 0.7;
  const fy = yOf(36); // fa çizgisi (fa anahtarında 4. çizgi)
  node('circle', { cx, cy: fy, r: s * 0.42, fill: 'currentColor' }, g);
  node('path', {
    fill: 'none', stroke: 'currentColor', 'stroke-width': s * 0.3, 'stroke-linecap': 'round',
    d: `M ${cx - s * 0.3} ${fy - s * 0.2} C ${cx - s * 0.2} ${fy - s * 1.4} ${cx + s * 2.1} ${fy - s * 1.6} ${cx + s * 2.1} ${fy + s * 0.2} C ${cx + s * 2.1} ${fy + s * 1.8} ${cx + s * 0.6} ${fy + s * 3.2} ${cx - s * 0.6} ${fy + s * 3.6}`,
  }, g);
  node('circle', { cx: cx + s * 2.8, cy: yOf(37), r: s * 0.2, fill: 'currentColor' }, g);
  node('circle', { cx: cx + s * 2.8, cy: yOf(35), r: s * 0.2, fill: 'currentColor' }, g);
}

function accidental(g, kind, x, y, s) {
  const w = s * 0.12;
  const attrs = { fill: 'none', stroke: 'currentColor', 'stroke-width': w, 'stroke-linecap': 'butt' };
  if (kind === 1) {
    node('path', { ...attrs, d: `M ${x - s * 0.22} ${y - s * 1.2} V ${y + s * 1.25} M ${x + s * 0.22} ${y - s * 1.3} V ${y + s * 1.15}` }, g);
    node('path', { ...attrs, 'stroke-width': s * 0.28, d: `M ${x - s * 0.5} ${y - s * 0.3} L ${x + s * 0.5} ${y - s * 0.55} M ${x - s * 0.5} ${y + s * 0.5} L ${x + s * 0.5} ${y + s * 0.25}` }, g);
  } else if (kind === -1) {
    node('path', { ...attrs, d: `M ${x - s * 0.35} ${y - s * 1.7} V ${y + s * 0.5}` }, g);
    node('path', { ...attrs, 'stroke-width': s * 0.18, d: `M ${x - s * 0.35} ${y + s * 0.5} C ${x + s * 0.7} ${y - s * 0.1} ${x + s * 0.5} ${y - s * 0.75} ${x - s * 0.35} ${y - s * 0.2}` }, g);
  } else if (kind === 0) {
    node('path', { ...attrs, d: `M ${x - s * 0.3} ${y - s * 1.2} V ${y + s * 0.6} M ${x + s * 0.3} ${y - s * 0.6} V ${y + s * 1.2}` }, g);
    node('path', { ...attrs, 'stroke-width': s * 0.26, d: `M ${x - s * 0.3} ${y - s * 0.35} L ${x + s * 0.3} ${y - s * 0.55} M ${x - s * 0.3} ${y + s * 0.55} L ${x + s * 0.3} ${y + s * 0.35}` }, g);
  } else if (kind === 2) {
    node('path', { ...attrs, 'stroke-width': s * 0.2, d: `M ${x - s * 0.35} ${y - s * 0.35} L ${x + s * 0.35} ${y + s * 0.35} M ${x - s * 0.35} ${y + s * 0.35} L ${x + s * 0.35} ${y - s * 0.35}` }, g);
  } else if (kind === -2) {
    accidental(g, -1, x - s * 0.35, y, s);
    accidental(g, -1, x + s * 0.35, y, s);
  }
}

function rest(g, dur, x, yOf, s) {
  const fill = { fill: 'currentColor' };
  if (dur === 1) node('rect', { ...fill, x: x - s * 0.6, y: yOf(36), width: s * 1.2, height: s * 0.5 }, g);
  else if (dur === 2) node('rect', { ...fill, x: x - s * 0.6, y: yOf(34) - s * 0.5, width: s * 1.2, height: s * 0.5 }, g);
  else if (dur === 4) {
    const y = yOf(34);
    node('path', {
      fill: 'none', stroke: 'currentColor', 'stroke-width': s * 0.28, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      d: `M ${x - s * 0.25} ${y - s * 1.4} L ${x + s * 0.35} ${y - s * 0.6} L ${x - s * 0.3} ${y + s * 0.1} L ${x + s * 0.3} ${y + s * 0.7} C ${x - s * 0.4} ${y + s * 0.5} ${x - s * 0.3} ${y + s * 1.3} ${x + s * 0.05} ${y + s * 1.4}`,
    }, g);
  } else {
    const count = flagCount(dur);
    for (let i = 0; i < count; i += 1) {
      const y = yOf(35) + i * s;
      node('circle', { ...fill, cx: x - s * 0.25 - i * s * 0.12, cy: y, r: s * 0.25 }, g);
      node('path', { fill: 'none', stroke: 'currentColor', 'stroke-width': s * 0.14, d: `M ${x - s * 0.3 - i * s * 0.12} ${y + s * 0.15} Q ${x + s * 0.1} ${y + s * 0.2} ${x + s * 0.4 - i * s * 0.12} ${y - s * 0.25}` }, g);
    }
    node('path', { fill: 'none', stroke: 'currentColor', 'stroke-width': s * 0.14, d: `M ${x + s * 0.4} ${yOf(35) - s * 0.25} L ${x - s * 0.15} ${yOf(35) + count * s + s * 0.6}` }, g);
  }
}

function noteHead(g, item, x, y, s) {
  const hollow = item.dur <= 2;
  const rx = item.dur === 1 ? s * 0.78 : s * 0.62;
  const ry = s * 0.44;
  const attrs = hollow
    ? { fill: 'none', stroke: 'currentColor', 'stroke-width': s * (item.dur === 1 ? 0.2 : 0.16) }
    : { fill: 'currentColor' };
  node('ellipse', { ...attrs, cx: x, cy: y, rx: hollow ? rx - s * 0.08 : rx, ry: hollow ? ry - s * 0.06 : ry, transform: `rotate(${item.dur === 1 ? -10 : -20} ${x} ${y})` }, g);
}

function ledgerLines(g, pos, x, yOf, s) {
  const draw = (p) => node('line', { x1: x - s * 1.0, x2: x + s * 1.0, y1: yOf(p), y2: yOf(p), stroke: 'currentColor', 'stroke-width': s * 0.12 }, g);
  for (let p = 28; p >= pos; p -= 2) draw(p);
  for (let p = 40; p <= pos; p += 2) draw(p);
}

function flags(g, count, x, yEnd, up, s) {
  for (let i = 0; i < count; i += 1) {
    const y = yEnd + (up ? 1 : -1) * i * s * 0.85;
    const dir = up ? 1 : -1;
    node('path', {
      fill: 'currentColor',
      d: `M ${x} ${y} C ${x + s * 0.2} ${y + dir * s * 0.9} ${x + s * 1.2} ${y + dir * s * 1.2} ${x + s * 0.9} ${y + dir * s * 2.4} C ${x + s * 0.95} ${y + dir * s * 1.5} ${x + s * 0.4} ${y + dir * s * 1.2} ${x} ${y + dir * s * 0.9} Z`,
    }, g);
  }
}

// --- Bir satırın çizimi --------------------------------------------------------------------

function drawLine(container, line, { fifths, time, showNames, s, width, first, last, clef }) {
  // Dikey yer: satırdaki en yüksek/alçak notaya göre
  let maxPos = TOP_LINE + 3;
  let minPos = BOTTOM_LINE - 3;
  for (const measure of line.measures) {
    for (const placed of measure.items) {
      if (placed.item.rest) continue;
      const pos = posOf(placed.item);
      maxPos = Math.max(maxPos, pos + 7);
      minPos = Math.min(minPos, pos - 7);
    }
  }
  const half = s / 2;
  const top = (maxPos - TOP_LINE) * half + s;
  const yOf = (pos) => top + (TOP_LINE - pos) * half;
  const staffBottom = yOf(minPos);
  const nameY = staffBottom + s * 1.6;
  const height = nameY + (showNames ? s * 1.2 : 0);

  const svg = node('svg', { class: 'staff-line', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  const g = node('g', {}, svg);

  // Porte çizgileri
  for (let p = BOTTOM_LINE; p <= TOP_LINE; p += 2) {
    node('line', { x1: 0, x2: width - 1, y1: yOf(p), y2: yOf(p), stroke: 'currentColor', 'stroke-width': s * 0.1, class: 'staff-rule' }, g);
  }
  node('line', { x1: 0.5, x2: 0.5, y1: yOf(TOP_LINE), y2: yOf(BOTTOM_LINE), stroke: 'currentColor', 'stroke-width': s * 0.12 }, g);

  if (clef === 'bass') bassClef(g, s * 0.4, yOf, s);
  else trebleClef(g, s * 0.4, yOf, s);
  let x = s * 3.2;
  const sigSteps = signatureSteps(fifths);
  for (const step of sigSteps) {
    const sigPos = (fifths > 0 ? SHARP_POS[step] : FLAT_POS[step]) - (clef === 'bass' ? 2 : 0);
    accidental(g, fifths > 0 ? 1 : -1, x, yOf(sigPos), s);
    x += s * 1.05;
  }
  x += s * 0.4;
  if (first) {
    for (const [text, pos] of [[time.num, 36], [time.den, 32]]) {
      node('text', { x: x + s * 0.9, y: yOf(pos) + s * 0.72, 'text-anchor': 'middle', 'font-size': s * 2.1, 'font-weight': 800, 'font-family': 'Georgia, "Times New Roman", serif', fill: 'currentColor', class: 'staff-time' }, g).textContent = String(text);
    }
    x += s * 2.2;
  }

  const groups = beatGroups(time);
  const spare = Math.max(0, width - x - line.width);
  const stretch = last && line.width + x < width * 0.7 ? 0 : spare / Math.max(1, line.count);

  for (const measure of line.measures) {
    const measureX = x;
    // Ölçü değişimi: ölçünün başına yeni ölçü işareti
    const meterHere = measure.items[0]?.item.meter;
    if (meterHere) {
      const [num, den] = meterHere.split('/');
      for (const [text, pos] of [[num, 36], [den, 32]]) {
        node('text', { x: measureX + s * 1.6, y: yOf(pos) + s * 0.72, 'text-anchor': 'middle', 'font-size': s * 2.1, 'font-weight': 800, 'font-family': 'Georgia, "Times New Roman", serif', fill: 'currentColor', class: 'staff-time' }, g).textContent = text;
      }
    }
    // Bu ölçüdeki notaların gerçek x konumları
    let extra = 0;
    const placedItems = measure.items.map((placed) => {
      const at = { ...placed, cx: measureX + placed.x + extra + s * 0.6 };
      extra += stretch;
      return at;
    });
    const measureWidth = measure.width + extra;

    // Işın grupları
    const beamGroups = [];
    let cursor = 0;
    let boundaryIndex = 0;
    let boundary = groups[0] ?? 1;
    let currentGroup = [];
    const flush = () => {
      if (currentGroup.length > 1) beamGroups.push(currentGroup);
      currentGroup = [];
    };
    for (const placed of placedItems) {
      const { item } = placed;
      while (cursor >= boundary - 1e-9) {
        flush();
        boundaryIndex += 1;
        boundary += groups[boundaryIndex % groups.length] ?? 1;
      }
      if (!item.rest && item.dur >= 8) currentGroup.push(placed);
      else flush();
      cursor += beats(item);
    }
    flush();
    const beamed = new Set(beamGroups.flat());

    for (const placed of placedItems) {
      const { item, cx } = placed;
      if (item.rest) {
        rest(g, item.dur, cx, yOf, s);
        if (item.dots) node('circle', { cx: cx + s * 0.9, cy: yOf(35), r: s * 0.16, fill: 'currentColor' }, g);
        continue;
      }
      const pos = posOf(item);
      const y = yOf(pos);
      ledgerLines(g, pos, cx, yOf, s);
      if (item.shown !== null && item.shown !== undefined) accidental(g, item.shown, cx - s * 1.45, y, s);
      noteHead(g, item, cx, y, s);
      for (let d = 0; d < item.dots; d += 1) {
        node('circle', { cx: cx + s * (1.05 + d * 0.5), cy: pos % 2 === 0 ? y - half : y, r: s * 0.16, fill: 'currentColor' }, g);
      }
      if (item.dur >= 2 && !beamed.has(placed)) {
        const up = pos < MIDDLE;
        const stemX = up ? cx + s * 0.56 : cx - s * 0.56;
        const end = up ? Math.min(y - s * 3.4, yOf(MIDDLE)) : Math.max(y + s * 3.4, yOf(MIDDLE));
        node('line', { x1: stemX, x2: stemX, y1: y, y2: end, stroke: 'currentColor', 'stroke-width': s * 0.13 }, g);
        flags(g, flagCount(item.dur), stemX, end, up, s);
      }
      if (showNames) {
        node('text', { x: cx, y: nameY, 'text-anchor': 'middle', 'font-size': s * 1.15, class: 'staff-name' }, g).textContent = pitchLabel(item.step, item.alter);
      }
    }

    // Işınlar
    for (const group of beamGroups) {
      const positions = group.map((p) => posOf(p.item));
      const up = positions.reduce((a, b) => a + b, 0) / positions.length < MIDDLE;
      const stemXs = group.map((p) => (up ? p.cx + s * 0.56 : p.cx - s * 0.56));
      const ys = positions.map((p) => yOf(p));
      const firstEnd = up ? ys[0] - s * 3.2 : ys[0] + s * 3.2;
      const lastEnd = up ? ys[ys.length - 1] - s * 3.2 : ys[ys.length - 1] + s * 3.2;
      let slope = (lastEnd - firstEnd) / Math.max(1, stemXs[stemXs.length - 1] - stemXs[0]);
      slope = Math.max(-0.18, Math.min(0.18, slope));
      const beamY = (x0) => firstEnd + slope * (x0 - stemXs[0]);
      // Bütün saplar en az 2.6 aralık uzunlukta olsun
      let shift = 0;
      group.forEach((p, i) => {
        const need = up ? ys[i] - s * 2.6 - beamY(stemXs[i]) : beamY(stemXs[i]) - (ys[i] + s * 2.6);
        if (need < 0) shift = up ? Math.min(shift, need) : Math.max(shift, -need);
      });
      const at = (x0) => beamY(x0) + shift;
      group.forEach((p, i) => {
        node('line', { x1: stemXs[i], x2: stemXs[i], y1: ys[i], y2: at(stemXs[i]), stroke: 'currentColor', 'stroke-width': s * 0.13 }, g);
      });
      const thickness = s * 0.5;
      const beamLine = (xa, xb, level) => {
        const offset = level * s * 0.8 * (up ? 1 : -1);
        const ya = at(xa) + offset;
        const yb = at(xb) + offset;
        const dy = up ? thickness : -thickness;
        node('path', { d: `M ${xa} ${ya} L ${xb} ${yb} L ${xb} ${yb + dy} L ${xa} ${ya + dy} Z`, fill: 'currentColor' }, g);
      };
      beamLine(stemXs[0], stemXs[stemXs.length - 1], 0);
      for (let level = 1; level < 3; level += 1) {
        group.forEach((p, i) => {
          if (flagCount(p.item.dur) <= level) return;
          const next = group[i + 1];
          const prev = group[i - 1];
          if (next && flagCount(next.item.dur) > level) beamLine(stemXs[i], stemXs[i + 1], level);
          else if (!(prev && flagCount(prev.item.dur) > level)) {
            const toward = next ? s * 1.1 : -s * 1.1;
            beamLine(stemXs[i], stemXs[i] + toward, level);
          }
        });
      }
    }

    // Üçleme gibi grupların sayısı (grubun üstünde)
    let tupletGroup = [];
    const drawTuplet = () => {
      if (!tupletGroup.length) return;
      const xs = tupletGroup.map((p) => p.cx);
      const tops = tupletGroup.map((p) => (p.item.rest ? yOf(TOP_LINE) : yOf(posOf(p.item)) - s * 3.6));
      const y = Math.min(yOf(TOP_LINE), ...tops) - s * 0.7;
      const textNode = node('text', { x: (Math.min(...xs) + Math.max(...xs)) / 2 + s * 0.3, y, 'text-anchor': 'middle', 'font-size': s * 1.3, 'font-style': 'italic', 'font-weight': 700, fill: 'currentColor', class: 'staff-tuplet' }, g);
      textNode.textContent = String(tupletGroup[0].item.tup);
      tupletGroup = [];
    };
    for (const placed of placedItems) {
      if (placed.item.tup && placed.item.tupPos === 0) drawTuplet();
      if (placed.item.tup) tupletGroup.push(placed);
      else drawTuplet();
    }
    drawTuplet();

    x = measureX + measureWidth;
    const isFinal = last && measure === line.measures[line.measures.length - 1];
    if (isFinal) {
      node('line', { x1: x - s * 0.7, x2: x - s * 0.7, y1: yOf(TOP_LINE), y2: yOf(BOTTOM_LINE), stroke: 'currentColor', 'stroke-width': s * 0.12 }, g);
      node('rect', { x: x - s * 0.45, y: yOf(TOP_LINE), width: s * 0.45, height: yOf(BOTTOM_LINE) - yOf(TOP_LINE), fill: 'currentColor' }, g);
    } else {
      node('line', { x1: x, x2: x, y1: yOf(TOP_LINE), y2: yOf(BOTTOM_LINE), stroke: 'currentColor', 'stroke-width': s * 0.12 }, g);
    }
  }
  container.append(svg);
}

/**
 * Besteyi container içine çizer.
 * options: { measures, fifths, time: {num, den}, showNames, scale }
 */
export function renderStaff(container, { measures, fifths, time, showNames = true, scale = 1, clef = 'treble' }) {
  clefShift = clef === 'bass' ? 12 : 0;
  const s = 9.5 * scale; // porte aralığı (piksel)
  const width = Math.max(240, Math.floor(container.clientWidth || 320));
  const marked = withAccidentals(measures, fifths);
  const headerWidth = s * 3.6 + signatureSteps(fifths).length * s * 1.05 + s * 0.4;
  const firstExtra = s * 2.2;

  // Ölçüleri satırlara dağıt
  const laid = marked.map((measure) => measureLayout(measure, s));
  const lines = [];
  let line = { measures: [], width: 0, count: 0 };
  for (const measure of laid) {
    const available = width - headerWidth - (lines.length === 0 ? firstExtra : 0) - 2;
    if (line.measures.length && line.width + measure.width > available) {
      lines.push(line);
      line = { measures: [], width: 0, count: 0 };
    }
    line.measures.push(measure);
    line.width += measure.width;
    line.count += measure.items.length;
  }
  if (line.measures.length) lines.push(line);

  container.replaceChildren();
  if (!lines.length) {
    // Boş porte
    lines.push({ measures: [], width: 0, count: 0 });
  }
  lines.forEach((current, index) =>
    drawLine(container, current, { fifths, time, showNames, s, width, first: index === 0, last: index === lines.length - 1, clef })
  );
}

/** Genişlik değişince yeniden çizer; bırakmak için dönen nesnenin stop()'unu çağırın. */
export function watchStaff(container, getOptions) {
  let frame = 0;
  let lastWidth = -1;
  const draw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => renderStaff(container, getOptions()));
  };
  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
        const width = Math.round(entries[0].contentRect.width);
        if (width !== lastWidth) {
          lastWidth = width;
          draw();
        }
      })
    : null;
  observer?.observe(container);
  draw();
  return { refresh: draw, stop: () => { cancelAnimationFrame(frame); observer?.disconnect(); } };
}
