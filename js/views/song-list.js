/**
 * Ana ekran: şarkı listesi, arama, kategori düğmeleri ve sıralama.
 *
 * Hız için:
 *  - her sıralama türü bir kez hesaplanır, satırlar bir kez oluşturulur;
 *  - liste 100'er satır hâlinde gösterilir; aşağı kaydırdıkça devamı eklenir.
 * Böylece binlerce şarkıda da arama, filtre ve sıralama anında tepki verir.
 */
import { el, icon, srOnly } from '../lib/dom.js';
import { compareText, foldForSearch, matchesQuery } from '../lib/text.js';
import { categoryTag } from './components.js';

const SORTERS = {
  title: (a, b) => compareText(a.song.title, b.song.title) || compareText(a.song.artist, b.song.artist),
  artist: (a, b) => compareText(a.song.artist, b.song.artist) || compareText(a.song.title, b.song.title),
  recent: (a, b) => b.song.createdAt - a.song.createdAt,
};
const DEFAULT_SORT = 'title';
const SORT_STORAGE_KEY = 'repertuvarim.siralama';
const TAGS_PER_ROW = 2;
const PAGE_SIZE = 100; // bir seferde eklenen satır sayısı
const PRELOAD_MARGIN = '800px 0px'; // listenin sonuna bu kadar yaklaşınca devamı eklenir

/**
 * root: #view-list bölümü. songs ve categories: veri katmanından gelen listeler.
 */
export function createSongListView(root, { songs, categories, usesSampleData }) {
  const ui = {
    search: root.querySelector('#search'),
    clearSearch: root.querySelector('#search-clear'),
    chips: root.querySelector('#filter-chips'),
    count: root.querySelector('#song-count'),
    sort: root.querySelector('#sort'),
    list: root.querySelector('#song-list'),
    more: root.querySelector('#list-more'),
    empty: root.querySelector('#list-empty'),
    notice: root.querySelector('#sample-notice'),
  };

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  // Her şarkı için arama metni bir kez hazırlanır; satır ilk gösterildiğinde oluşturulur.
  const entries = songs.map((song) => ({
    song,
    searchText: foldForSearch(`${song.title} ${song.artist}`),
    row: null,
  }));
  const sortedCache = new Map();

  const state = { query: '', filter: 'all', sort: loadSort() };
  let visibleEntries = []; // aramaya ve filtreye uyan şarkılar, sıralı
  let shownCount = 0; // bunlardan kaçı şu an ekranda

  // Listenin sonundaki işaret ekrana yaklaşınca sıradaki satırlar eklenir.
  const moreObserver =
    'IntersectionObserver' in window
      ? new IntersectionObserver((items) => {
          if (items.some((item) => item.isIntersecting)) showMore();
        }, { rootMargin: PRELOAD_MARGIN })
      : null;

  ui.sort.value = state.sort;
  ui.notice.hidden = !usesSampleData;
  renderChips();
  render();

  let frame = 0;
  ui.search.addEventListener('input', () => {
    state.query = foldForSearch(ui.search.value);
    ui.clearSearch.hidden = ui.search.value === '';
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => render({ toTop: true }));
  });

  ui.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.search.value) {
      event.preventDefault();
      clearSearch();
    }
  });

  ui.clearSearch.addEventListener('click', () => {
    clearSearch();
    ui.search.focus();
  });

  ui.sort.addEventListener('change', () => {
    state.sort = Object.hasOwn(SORTERS, ui.sort.value) ? ui.sort.value : DEFAULT_SORT;
    saveSort(state.sort);
    render({ toTop: true });
  });

  ui.chips.addEventListener('click', (event) => {
    const chip = event.target.closest('button[data-filter]');
    if (chip) setFilter(chip.dataset.filter);
  });

  function clearSearch() {
    ui.search.value = '';
    state.query = '';
    ui.clearSearch.hidden = true;
    render({ toTop: true });
  }

  function setFilter(filter) {
    state.filter = filter;
    for (const chip of ui.chips.querySelectorAll('button[data-filter]')) {
      const selected = chip.dataset.filter === filter;
      chip.setAttribute('aria-pressed', String(selected));
      if (selected) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    render({ toTop: true });
  }

  function renderChips() {
    const chips = [
      { filter: 'all', label: 'Tümü' },
      { filter: 'favorites', label: 'Favoriler', iconName: 'star' },
      ...categories.map((category) => ({
        filter: `cat:${category.id}`,
        label: category.name,
        color: category.color,
      })),
    ];
    ui.chips.replaceChildren(
      ...chips.map((chip) =>
        el(
          'button',
          {
            type: 'button',
            class: chip.color ? 'chip chip--category' : 'chip',
            dataset: chip.color ? { filter: chip.filter, color: chip.color } : { filter: chip.filter },
            'aria-pressed': String(chip.filter === state.filter),
          },
          chip.iconName ? icon(chip.iconName, 'icon chip__icon') : null,
          chip.label
        )
      )
    );
  }

  function isVisible(entry) {
    const { song } = entry;
    if (state.filter === 'favorites' && !song.favorite) return false;
    if (state.filter.startsWith('cat:') && !song.categoryIds.includes(state.filter.slice(4))) {
      return false;
    }
    return matchesQuery(entry.searchText, state.query);
  }

  function sortedEntries() {
    if (!sortedCache.has(state.sort)) {
      sortedCache.set(state.sort, [...entries].sort(SORTERS[state.sort]));
    }
    return sortedCache.get(state.sort);
  }

  function render({ toTop = false } = {}) {
    visibleEntries = sortedEntries().filter(isVisible);

    ui.count.textContent = `${visibleEntries.length} şarkı`;
    const isEmpty = visibleEntries.length === 0;
    ui.list.hidden = isEmpty;
    ui.empty.hidden = !isEmpty;
    if (isEmpty) ui.empty.replaceChildren(...emptyContent());

    // Liste değiştiyse başına dön; aksi hâlde aşağıda boş bir alan kalabilir.
    if (toTop && window.scrollY > 0) window.scrollTo(0, 0);

    shownCount = 0;
    ui.list.replaceChildren();
    ui.more.hidden = true;
    showMore();
  }

  /** Sıradaki satırları listeye ekler. */
  function showMore() {
    if (shownCount >= visibleEntries.length) return;
    // Gözlemci yoksa (çok eski tarayıcı) hepsi bir kerede gösterilir.
    const end = moreObserver ? Math.min(shownCount + PAGE_SIZE, visibleEntries.length) : visibleEntries.length;
    const fragment = document.createDocumentFragment();
    for (let i = shownCount; i < end; i += 1) fragment.append(rowFor(visibleEntries[i]));
    ui.list.append(fragment);
    shownCount = end;

    ui.more.hidden = shownCount >= visibleEntries.length;
    if (moreObserver && !ui.more.hidden) {
      // Yeniden gözlemlemek, işaretin hâlâ yakında olup olmadığını hemen sorar;
      // büyük ekranlarda gerekirse bir sonraki parti de eklenir.
      moreObserver.unobserve(ui.more);
      moreObserver.observe(ui.more);
    }
  }

  function emptyContent() {
    const showAll = () => setFilter('all');
    if (state.query) {
      return [
        el('p', { class: 'empty__title', text: `“${ui.search.value.trim()}” ile eşleşen şarkı yok.` }),
        el('div', { class: 'empty__actions' },
          el('button', { class: 'button button--quiet', type: 'button', onclick: clearSearch }, 'Aramayı temizle'),
          state.filter !== 'all'
            ? el('button', { class: 'button button--quiet', type: 'button', onclick: showAll }, 'Tüm şarkılarda ara')
            : null
        ),
      ];
    }
    if (state.filter === 'favorites') {
      return [
        el('p', { class: 'empty__title', text: 'Henüz favori şarkınız yok.' }),
        el('p', { class: 'empty__text', text: 'Bir şarkıyı favorilere eklediğinizde burada görünür.' }),
      ];
    }
    if (state.filter.startsWith('cat:')) {
      return [
        el('p', { class: 'empty__title', text: 'Bu kategoride henüz şarkı yok.' }),
        el('div', { class: 'empty__actions' },
          el('button', { class: 'button button--quiet', type: 'button', onclick: showAll }, 'Tüm şarkıları göster')
        ),
      ];
    }
    return [el('p', { class: 'empty__title', text: 'Henüz şarkı eklenmedi.' })];
  }

  function rowFor(entry) {
    if (entry.row) return entry.row;
    const { song } = entry;
    const songCategories = song.categoryIds.map((id) => categoryById.get(id)).filter(Boolean);
    const shown = songCategories.slice(0, TAGS_PER_ROW);
    const others = songCategories.slice(TAGS_PER_ROW).map((category) => category.name);

    entry.row = el(
      'li',
      { class: 'song-row' },
      el(
        'a',
        { class: 'song-row__link', href: `#/sarki/${encodeURIComponent(song.id)}` },
        el(
          'span',
          { class: 'song-row__main' },
          el(
            'span',
            { class: 'song-row__title' },
            el('span', { class: 'song-row__title-text', text: song.title }),
            song.favorite ? el('span', { class: 'song-row__fav' }, icon('star'), srOnly('Favori')) : null
          ),
          el(
            'span',
            { class: 'song-row__meta' },
            el('span', { class: 'song-row__artist', text: song.artist || 'Sanatçı belirtilmemiş' }),
            shown.map(categoryTag),
            others.length
              ? el('span', { class: 'cat-more', title: others.join(', ') }, `+${others.length}`, srOnly(` (${others.join(', ')})`))
              : null
          )
        ),
        song.key ? el('span', { class: 'song-row__key' }, srOnly('Ton: '), song.key) : null
      )
    );
    return entry.row;
  }
}

function loadSort() {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    return saved && Object.hasOwn(SORTERS, saved) ? saved : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

function saveSort(value) {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, value);
  } catch {
    // Tercih kaydedilemezse sıralama yine çalışır; yalnızca hatırlanmaz.
  }
}
