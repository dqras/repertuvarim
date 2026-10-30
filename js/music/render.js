/**
 * Şarkıyı ekrana çizer: akorlar sözlerin üstünde, çalındığı hecenin hizasında.
 *
 * - Kelimeler hiçbir zaman bölünmez; dar ekranda satır kelime aralarından kayar ve
 *   akorlar heceleriyle birlikte alt satıra geçer.
 * - Akor hecesinden genişse sonraki kelimenin üstüne taşabilir. İki akor çakışacaksa
 *   sözler yerinde kalır, sonraki akor biraz sağa kayar (sitelerdeki görünümün aynısı).
 *   Sözlerin arasına boşluk yalnızca akor hecesinden çok uzağa düşecekse açılır.
 * - Satır sonundaki akorlar (söz bittikten sonra çalınanlar) kendi genişlikleriyle yer
 *   kaplar; ekranın sağından taşmaz, gerekirse alt satıra geçer.
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
    else loose.push({ start: chord.at, end: chord.at, word: '', bare: true, chords: [{ at: 0, name: chord.name }] });
  }
  const blocks = [...words, ...loose].sort((a, b) => a.start - b.start);

  // Sözden sonra gelen akorlar tek parça kalır: sığmazsa birlikte alt satıra geçerler.
  const tail = words.length && loose.length ? document.createElement('span') : null;
  if (tail) tail.className = 'w-tail';

  blocks.forEach((block, index) => {
    if (block.bare && tail && !tail.parentNode) line.append(tail);
    const span = document.createElement('span');
    span.className = block.bare ? 'w w--bare' : 'w';
    const cuts = [...new Set([0, ...block.chords.map((c) => c.at)])].sort((a, b) => a - b);
    cuts.forEach((cut, k) => {
      const piece = document.createElement('span');
      piece.className = 'p';
      piece.textContent = block.word.slice(cut, cuts[k + 1] ?? block.word.length) || ZERO_WIDTH;
      for (const chord of block.chords.filter((c) => c.at === cut)) piece.append(chordElement(chord.name));
      span.append(piece);
    });
    if (block.bare) {
      // Görünmez bir kopya: blok akorun genişliği kadar yer kaplasın (taşmasın, sığmazsa alt satıra geçsin).
      const ghost = document.createElement('span');
      ghost.className = 'c-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.dataset.chord = block.chords[0].name; // yazı CSS ile çizilir, metne karışmaz
      span.append(ghost);
    }
    if (block.bare && tail) {
      tail.append(span);
    } else {
      line.append(span);
      if (index < blocks.length - 1) line.append(' ');
    }
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

// Bir akor, sözleri ayırmamak için hecesinden en fazla bu kadar (akor yazısının
// boyunun katı) sağa kayabilir; daha fazlası gerekirse kelimeler arası açılır.
const MAX_DRIFT = 2.5;

function layoutLine(line) {
  const words = [...line.querySelectorAll('.w')];
  for (const word of words) word.style.marginRight = '';
  placeChords(words);
  // Satır sonunda hecesinden geniş bir akor ekranın sağından taşıyorsa, o kelimeyi
  // alt satıra geçir (sağına görünmez bir pay eklenir; sığmayınca tarayıcı alt satıra alır).
  const limit = line.clientWidth;
  for (let round = 0; round < 4; round += 1) {
    let moved = false;
    for (const word of words) {
      if (word.offsetLeft <= 0) continue; // satırın ilk kelimesi: gidecek yer yok
      for (const chord of word.querySelectorAll('.c')) {
        const right = word.offsetLeft + chord.parentElement.offsetLeft + chord.offsetLeft + chord.offsetWidth;
        if (right > limit + 0.5) {
          // Kelimenin sağındaki pay satırın sonuna kadar uzanınca kelime sığmaz, alt satıra geçer.
          word.style.marginRight = `${Math.ceil(limit - word.offsetLeft - word.offsetWidth) + 1}px`;
          moved = true;
          break;
        }
      }
    }
    if (!moved) break;
    placeChords(words);
  }
}

function placeChords(words) {
  for (const word of words) {
    word.style.paddingRight = '';
    for (const chord of word.querySelectorAll('.c')) chord.style.left = '';
  }
  let prevEnd = -Infinity;
  let rowTop = null;
  let prevWord = null;
  for (const word of words) {
    const chords = [...word.querySelectorAll('.c')];
    const size = chords.length ? parseFloat(getComputedStyle(chords[0]).fontSize) : 0;
    const gap = size * 0.5;
    if (word.offsetTop !== rowTop) {
      rowTop = word.offsetTop;
      prevEnd = -Infinity;
      prevWord = null;
    }
    chords.forEach((chord, index) => {
      let natural = word.offsetLeft + chord.parentElement.offsetLeft;
      let need = prevEnd + gap - natural;
      // Önceki blok yalnızca akorsa (sözsüz) araya boşluk açmak sorun değil; sözlerin
      // arasını ise yalnızca akor hecesinden çok uzağa kayacaksa açarız.
      const mayPad = prevWord && (prevWord.classList.contains('w--bare') || need > size * MAX_DRIFT);
      if (need > 0 && index === 0 && mayPad) {
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
