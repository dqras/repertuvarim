/**
 * Şarkıyı ekrana çizer: akorlar sözlerin üstünde, çalındığı hecenin hizasında.
 *
 * - Kelimeler hiçbir zaman bölünmez; dar ekranda satır kelime aralarından kayar ve
 *   akorlar heceleriyle birlikte alt satıra geçer.
 * - Akor hecesinden genişse sonraki kelimenin üstüne taşabilir; yalnızca iki akor
 *   çakışacaksa kelimeler arasına boşluk açılır.
 * - Boş satırlar kıtaları ayırır; "Nakarat" gibi satırlar küçük başlık olarak gösterilir.
 * Ekran genişliği ya da yazı boyutu değişince yerleşim kendiliğinden yenilenir.
 */
import { isAnnotation, isChord } from './chords.js';
import { isSectionLabel } from './song-text.js';

const INLINE_CHORD = /\[([^\]\n]*)\]/g;
const ZERO_WIDTH = '​'; // boş akor parçasının satır yüksekliğini koruması için

/** Bir satırı düz metne ve akor konumlarına ayırır: { text, chords: [{ at, name }] } */
function parseLine(line) {
  const chords = [];
  let text = '';
  let last = 0;
  for (const match of line.matchAll(INLINE_CHORD)) {
    text += line.slice(last, match.index);
    const name = match[1].trim();
    if (name) chords.push({ at: text.length, name });
    last = match.index + match[0].length;
  }
  text += line.slice(last);
  return { text, chords };
}

function chordElement(name) {
  const span = document.createElement('span');
  span.className = 'c';
  if (isAnnotation(name)) span.classList.add('c--note');
  else if (!isChord(name, { lenient: true })) span.classList.add('c--unknown');
  span.textContent = name;
  return span;
}

/** Akorlu bir satır: kelime kelime bloklar, her blokta akorlar üstte. */
function chordLine(text, chords) {
  const line = document.createElement('div');
  line.className = 'sl sl--chords';

  // Kelimeler ve metindeki yerleri
  const words = [...text.matchAll(/\S+/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    word: match[0],
    chords: [],
  }));

  // Her akor tek bir kelimeye bağlanır: içinde olduğu kelimeye; boşluktaysa sonraki
  // kelimeye; sonrasında kelime yoksa kendi boş bloğuna (yalnızca akordan oluşan satırlar).
  const loose = [];
  for (const chord of chords) {
    const owner = words.find((w) => chord.at >= w.start && chord.at < w.end) ?? words.find((w) => w.start >= chord.at);
    if (owner) owner.chords.push({ at: Math.max(chord.at, owner.start) - owner.start, name: chord.name });
    else loose.push({ start: chord.at, end: chord.at, word: '', chords: [{ at: 0, name: chord.name }] });
  }
  const blocks = [...words, ...loose].sort((a, b) => a.start - b.start);

  blocks.forEach((block, index) => {
    const span = document.createElement('span');
    span.className = 'w';
    const cuts = [...new Set([0, ...block.chords.map((c) => c.at)])].sort((a, b) => a - b);
    cuts.forEach((cut, k) => {
      const piece = document.createElement('span');
      piece.className = 'p';
      piece.textContent = block.word.slice(cut, cuts[k + 1] ?? block.word.length) || ZERO_WIDTH;
      for (const chord of block.chords.filter((c) => c.at === cut)) piece.append(chordElement(chord.name));
      span.append(piece);
    });
    line.append(span);
    if (index < blocks.length - 1) line.append(' ');
  });
  return line;
}

/**
 * Şarkı metnini (akorları [Am] biçiminde) container içine çizer.
 * Çizimden sonra layoutChords(container) çağrılmalıdır (watchLayout bunu kendisi yapar).
 */
export function renderSongContent(container, content) {
  const fragment = document.createDocumentFragment();
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  for (const raw of lines) {
    if (!raw.trim()) {
      const gap = document.createElement('div');
      gap.className = 'sl sl--gap';
      fragment.append(gap);
      continue;
    }
    const { text, chords } = parseLine(raw);
    if (!chords.length && isSectionLabel(text)) {
      const label = document.createElement('div');
      label.className = 'sl sl--section';
      label.textContent = text.trim().replace(/^[[(]\s*|\s*[\])]$/g, '').replace(/:\s*$/, '');
      fragment.append(label);
    } else if (!chords.length) {
      const plain = document.createElement('div');
      plain.className = 'sl sl--lyric';
      plain.textContent = text;
      fragment.append(plain);
    } else {
      fragment.append(chordLine(text, chords));
    }
  }
  container.replaceChildren(fragment);
}

/** Akorların çakışmasını önler (bkz. dosyanın başındaki kurallar). */
export function layoutChords(container) {
  for (const line of container.querySelectorAll('.sl--chords')) layoutLine(line);
}

function layoutLine(line) {
  const words = [...line.querySelectorAll('.w')];
  for (const word of words) {
    word.style.paddingRight = '';
    for (const chord of word.querySelectorAll('.c')) chord.style.left = '';
  }
  let prevEnd = -Infinity;
  let rowTop = null;
  let prevWord = null;
  for (const word of words) {
    const chords = [...word.querySelectorAll('.c')];
    const gap = chords.length ? parseFloat(getComputedStyle(chords[0]).fontSize) * 0.5 : 0;
    if (word.offsetTop !== rowTop) {
      rowTop = word.offsetTop;
      prevEnd = -Infinity;
      prevWord = null;
    }
    chords.forEach((chord, index) => {
      let natural = word.offsetLeft + chord.parentElement.offsetLeft;
      let need = prevEnd + gap - natural;
      if (need > 0 && index === 0 && prevWord) {
        prevWord.style.paddingRight = `${(parseFloat(prevWord.style.paddingRight) || 0) + need}px`;
        if (word.offsetTop !== rowTop) {
          // Açılan boşluk yüzünden kelime alt satıra geçti.
          rowTop = word.offsetTop;
          prevEnd = -Infinity;
        }
        natural = word.offsetLeft + chord.parentElement.offsetLeft;
        need = prevEnd + gap - natural;
      }
      const shift = Math.max(0, need);
      if (shift) chord.style.left = `${shift}px`;
      prevEnd = natural + shift + chord.offsetWidth;
    });
    prevWord = word;
  }
}

/**
 * Container'ın genişliği değiştikçe (telefonu yan çevirme, pencereyi büyütme,
 * yazı boyutu) akorları yeniden yerleştirir. Bırakmak için dönen fonksiyonu çağırın.
 */
export function watchLayout(container) {
  let frame = 0;
  let lastWidth = -1;
  const run = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => layoutChords(container));
  };
  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
        const width = Math.round(entries[0].contentRect.width);
        if (width !== lastWidth) {
          lastWidth = width;
          run();
        }
      })
    : null;
  observer?.observe(container);
  run();
  document.fonts?.ready?.then(run);
  return {
    refresh: run,
    stop() {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    },
  };
}
