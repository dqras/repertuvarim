/**
 * Kategoriler ekranı (#/kategoriler): kategori ekleme, adını/rengini değiştirme,
 * sırasını değiştirme ve silme.
 * Bir kategori silinince şarkılar silinmez; yalnızca o kategoriden çıkarılır.
 */
import { el, icon } from '../lib/dom.js';
import { CATEGORY_COLORS } from '../data/model.js';
import { describeStorageError } from '../data/db.js';
import { confirmDialog, nameDialog } from './dialog.js';
import { showMessage } from './components.js';

const COLOR_NAMES = {
  rose: 'Gül', sky: 'Gök', coral: 'Mercan', violet: 'Mor', green: 'Yeşil', teal: 'Camgöbeği', sand: 'Kum', slate: 'Gri',
};

/**
 * root: #view-categories. actions (veri katmanı):
 *   createCategory, updateCategory, reorderCategories, deleteCategory
 */
export function createCategoriesView(root, actions) {
  let categories = [];
  let songs = [];

  let sorting = false; // "Sırayı değiştir" açıkken oklar görünür

  function render() {
    const counts = new Map();
    for (const song of songs) for (const id of song.categoryIds) counts.set(id, (counts.get(id) ?? 0) + 1);

    const rows = categories.map((category, index) => {
      const body = [
        el('span', { class: 'manage-row__dot', dataset: { color: category.color }, 'aria-hidden': 'true' }),
        el('span', { class: 'manage-row__text' },
          el('span', { class: 'manage-row__title', text: category.name }),
          el('span', { class: 'manage-row__sub', text: songCount(counts.get(category.id) ?? 0) })),
      ];
      return el(
        'li',
        { class: 'manage-row', dataset: { id: category.id } },
        sorting
          ? el('div', { class: 'manage-row__main' }, body)
          : el('button', { type: 'button', class: 'manage-row__main manage-row__button', dataset: { action: 'edit' }, onclick: () => edit(category, counts.get(category.id) ?? 0) },
              body, el('span', { class: 'manage-row__edit', 'aria-hidden': 'true' }, icon('edit'))),
        sorting
          ? el('span', { class: 'manage-row__actions' },
              moveButton('up', index === 0, () => move(index, -1), `${category.name}: yukarı taşı`),
              moveButton('down', index === categories.length - 1, () => move(index, 1), `${category.name}: aşağı taşı`))
          : null
      );
    });

    root.replaceChildren(
      el(
        'div',
        { class: 'page page--screen' },
        el('h1', { class: 'screen-title', tabindex: '-1', text: 'Kategoriler' }),
        el('p', { class: 'muted manage-lead', text: sorting
          ? 'Oklarla sırayı değiştirin. Bu sıra, şarkı listesindeki kategori düğmelerinin sırasıdır.'
          : 'Adını, rengini değiştirmek ya da silmek için bir kategoriye dokunun. Silinen kategorideki şarkılar silinmez.' }),
        el('div', { class: 'setlist-view__actions' },
          sorting ? null : el('button', { type: 'button', class: 'button button--primary button--small', id: 'category-add', onclick: add }, icon('plus'), 'Yeni kategori'),
          categories.length > 1
            ? el('button', { type: 'button', class: 'button button--quiet button--small', id: 'category-sort', 'aria-pressed': String(sorting), onclick: toggleSorting }, sorting ? 'Bitti' : 'Sırayı değiştir')
            : null),
        rows.length
          ? el('ul', { class: 'manage-list', id: 'category-list', role: 'list' }, rows)
          : el('p', { class: 'placeholder', text: 'Henüz kategori yok.' })
      )
    );
  }

  function toggleSorting() {
    sorting = !sorting;
    render();
    root.querySelector('#category-sort')?.focus();
  }

  function moveButton(direction, disabled, onclick, label) {
    return el('button', { type: 'button', class: 'icon-button icon-button--small', 'aria-label': label, disabled, dataset: { action: direction }, onclick }, icon(direction));
  }

  function colorPicker(selected) {
    let value = selected;
    const group = el('div', { class: 'color-picker', role: 'radiogroup', 'aria-label': 'Renk' });
    const draw = () =>
      group.replaceChildren(
        ...CATEGORY_COLORS.map((color) =>
          el('button', {
            type: 'button',
            class: 'color-picker__swatch',
            role: 'radio',
            'aria-checked': String(color === value),
            'aria-label': COLOR_NAMES[color],
            dataset: { color },
            onclick: () => {
              value = color;
              draw();
            },
          })
        )
      );
    draw();
    return { element: el('div', { class: 'field' }, el('p', { class: 'field__label', text: 'Renk' }), group), get value() { return value; } };
  }

  async function add() {
    const used = new Set(categories.map((category) => category.color));
    const picker = colorPicker(CATEGORY_COLORS.find((color) => !used.has(color)) ?? CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]);
    const created = await nameDialog({
      title: 'Yeni kategori',
      label: 'Kategori adı',
      placeholder: 'ör. Düğün şarkıları',
      confirmLabel: 'Ekle',
      extra: picker.element,
      submit: (name) => actions.createCategory({ name, color: picker.value }),
    });
    if (created) showMessage(`“${created.name}” kategorisi eklendi.`);
  }

  async function edit(category, count) {
    const picker = colorPicker(category.color);
    const result = await nameDialog({
      title: 'Kategoriyi düzenle',
      label: 'Kategori adı',
      value: category.name,
      extra: picker.element,
      secondary: 'Sil',
      submit: (name) => actions.updateCategory(category.id, { name, color: picker.value }),
    });
    if (result?.secondary) await remove(category, count);
    else if (result) showMessage('Kategori kaydedildi.');
  }

  async function move(index, delta) {
    const ids = categories.map((category) => category.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await actions.reorderCategories(ids); // ekran, veri değişince update() ile yenilenir
    } catch (error) {
      showMessage(describeStorageError(error), { tone: 'error' });
    }
  }

  async function remove(category, count) {
    const ok = await confirmDialog({
      title: `“${category.name}” silinsin mi?`,
      message: count
        ? `Bu kategorideki ${count} şarkı silinmez; yalnızca bu kategoriden çıkarılır.`
        : 'Bu kategoride şarkı yok.',
      confirmLabel: 'Kategoriyi sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await actions.deleteCategory(category.id);
      showMessage(`“${category.name}” silindi.`);
    } catch (error) {
      showMessage(describeStorageError(error), { tone: 'error' });
    }
  }

  return {
    /** Ekranı verilen kategori ve şarkılarla (şarkı sayıları için) çizer. */
    show(nextCategories, nextSongs) {
      categories = nextCategories;
      songs = nextSongs;
      render();
    },
    /** Ekran açıkken veriler değişince yeniden çizer; odak korunmaya çalışılır. */
    update(nextCategories, nextSongs) {
      categories = nextCategories;
      songs = nextSongs;
      const focusedRow = document.activeElement?.closest?.('.manage-row')?.dataset.id;
      const focusedAction = document.activeElement?.dataset?.action;
      render();
      if (focusedRow && focusedAction) {
        // Odak, taşınan kategorinin aynı düğmesinde kalsın (o düğme artık kapalıysa "düzenle"de).
        const row = root.querySelector(`.manage-row[data-id="${CSS.escape(focusedRow)}"]`);
        const button = row?.querySelector(`[data-action="${focusedAction}"]`);
        (button && !button.disabled ? button : row?.querySelector('[data-action="edit"], button:not(:disabled)'))?.focus();
      }
    },
  };
}

function songCount(count) {
  return count ? `${count} şarkı` : 'Şarkı yok';
}
