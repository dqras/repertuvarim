/**
 * Setlistler: sahnede ya da provada çalınacak şarkıların sıralı listeleri.
 *
 *  #/setlistler           bütün setlistler, "Yeni setlist"
 *  #/setlist/<id>         bir setlistin şarkıları: ekle, sırasını değiştir, çıkar,
 *                         adını değiştir, setlisti sil
 *  #/setlist/<id>/<şarkı> şarkı ekranı; üstte "Önceki / Sıradaki" düğmeleri (app.js)
 *
 * Setlistten çıkarmak ya da setlisti silmek şarkıları silmez.
 */
import { el, icon } from '../lib/dom.js';
import { compareText } from '../lib/text.js';
import { describeStorageError } from '../data/db.js';
import { confirmDialog, nameDialog, pickDialog } from './dialog.js';
import { showMessage } from './components.js';

const songWord = (count) => (count ? `${count} şarkı` : 'Boş');

/** Yeni setlist oluşturma penceresi; oluşturulan setlisti (ya da null) döndürür. */
export function newSetlistDialog(createSetlist, songIds = []) {
  return nameDialog({
    title: 'Yeni setlist',
    label: 'Setlist adı',
    placeholder: 'ör. Cumartesi düğün',
    confirmLabel: 'Oluştur',
    submit: (name) => createSetlist(name, songIds),
  });
}

/** Setlistler ekranı (#/setlistler). */
export function createSetlistsView(root, { createSetlist }) {
  function render(setlists, songsById) {
    const rows = setlists.map((setlist) => {
      const count = setlist.songIds.filter((id) => songsById.has(id)).length;
      const first = setlist.songIds.map((id) => songsById.get(id)).filter(Boolean).slice(0, 3).map((song) => song.title);
      return el(
        'li',
        { class: 'setlist-row' },
        el('a', { class: 'setlist-row__link', href: `#/setlist/${encodeURIComponent(setlist.id)}` },
          el('span', { class: 'setlist-row__icon', 'aria-hidden': 'true' }, icon('list')),
          el('span', { class: 'setlist-row__text' },
            el('span', { class: 'setlist-row__title', text: setlist.name }),
            el('span', { class: 'setlist-row__sub', text: count ? `${songWord(count)} · ${first.join(', ')}${count > 3 ? '…' : ''}` : 'Henüz şarkı yok' })))
      );
    });

    root.replaceChildren(
      el(
        'div',
        { class: 'page page--screen' },
        el('h1', { class: 'screen-title', tabindex: '-1', text: 'Setlistler' }),
        el('button', { type: 'button', class: 'button button--primary', id: 'setlist-new', onclick: create }, icon('plus'), 'Yeni setlist'),
        rows.length
          ? el('ul', { class: 'setlist-list', id: 'setlist-list', role: 'list' }, rows)
          : el('div', { class: 'empty empty--setlists' },
              el('p', { class: 'empty__title', text: 'Henüz setlist yok' }),
              el('p', { class: 'muted', text: 'Sahnede ya da provada çalacağınız şarkıları bir setliste sırayla koyun. Çalarken bir dokunuşla sıradaki şarkıya geçersiniz.' }))
      )
    );
  }

  async function create() {
    const created = await newSetlistDialog(createSetlist);
    if (created) location.hash = `#/setlist/${encodeURIComponent(created.id)}`;
  }

  return { show: render, update: render };
}

/**
 * Tek bir setlistin ekranı (#/setlist/<id>).
 * actions: updateSetlist(id, changes), deleteSetlist(id), onDeleted()
 */
export function createSetlistView(root, actions) {
  let setlist = null;
  let songs = [];
  let songsById = new Map();
  let editing = false;

  function render() {
    if (!setlist) {
      root.replaceChildren(
        el('div', { class: 'page page--screen' },
          el('h1', { class: 'screen-title', tabindex: '-1', text: 'Setlist bulunamadı' }),
          el('p', { class: 'muted', text: 'Bu setlist silinmiş olabilir.' }),
          el('a', { class: 'button button--quiet', href: '#/setlistler' }, 'Setlistlere dön'))
      );
      return;
    }
    const items = setlist.songIds.map((id) => songsById.get(id)).filter(Boolean);
    const rows = items.map((song, index) => {
      const sub = [song.artist, song.key].filter(Boolean).join(' · ');
      const body = [
        el('span', { class: 'set-song__number', text: String(index + 1) }),
        el('span', { class: 'set-song__text' },
          el('span', { class: 'set-song__title', text: song.title }),
          sub ? el('span', { class: 'set-song__sub', text: sub }) : null),
      ];
      return el(
        'li',
        { class: 'set-song', dataset: { id: song.id } },
        editing
          ? el('div', { class: 'set-song__main' }, body)
          : el('a', { class: 'set-song__main set-song__link', href: `#/setlist/${encodeURIComponent(setlist.id)}/${encodeURIComponent(song.id)}` }, body),
        editing
          ? el('span', { class: 'manage-row__actions' },
              el('button', { type: 'button', class: 'icon-button icon-button--small', 'aria-label': `${song.title}: yukarı taşı`, dataset: { action: 'up' }, disabled: index === 0, onclick: () => move(song.id, -1) }, icon('up')),
              el('button', { type: 'button', class: 'icon-button icon-button--small', 'aria-label': `${song.title}: aşağı taşı`, dataset: { action: 'down' }, disabled: index === items.length - 1, onclick: () => move(song.id, 1) }, icon('down')),
              el('button', { type: 'button', class: 'icon-button icon-button--small icon-button--danger', 'aria-label': `${song.title}: setlistten çıkar`, dataset: { action: 'remove' }, onclick: () => removeSong(song) }, icon('close')))
          : null
      );
    });

    root.replaceChildren(
      el(
        'div',
        { class: 'page page--screen setlist-view' },
        el('h1', { class: 'screen-title', tabindex: '-1', text: setlist.name }),
        el('p', { class: 'muted setlist-view__count', id: 'setlist-count', text: songWord(items.length) }),
        el('div', { class: 'setlist-view__actions' },
          el('button', { type: 'button', class: 'button button--primary button--small', id: 'setlist-add-songs', onclick: addSongs }, icon('plus'), 'Şarkı ekle'),
          items.length > 0
            ? el('button', { type: 'button', class: 'button button--quiet button--small', id: 'setlist-edit', 'aria-pressed': String(editing), onclick: toggleEditing }, editing ? 'Bitti' : 'Sırayı düzenle')
            : null),
        items.length
          ? el('ol', { class: 'set-songs', id: 'set-songs', role: 'list' }, rows)
          : el('p', { class: 'placeholder', text: 'Bu setlistte henüz şarkı yok. “Şarkı ekle” ile ekleyin.' }),
        editing
          ? el('p', { class: 'field__hint', text: 'Oklarla sırayı değiştirin, ✕ ile şarkıyı setlistten çıkarın (şarkı silinmez).' })
          : null,
        el('section', { class: 'editor__danger setlist-view__manage', 'aria-label': 'Setlisti yönet' },
          el('button', { type: 'button', class: 'button button--quiet button--small', id: 'setlist-rename', onclick: rename }, icon('edit'), 'Adını değiştir'),
          el('button', { type: 'button', class: 'button button--danger-quiet', id: 'setlist-delete', onclick: remove }, icon('trash'), 'Setlisti sil'))
      )
    );
  }

  async function save(changes) {
    try {
      setlist = await actions.updateSetlist(setlist.id, changes);
      return setlist;
    } catch (error) {
      showMessage(describeStorageError(error), { tone: 'error' });
      return null;
    }
  }

  async function addSongs() {
    const inSet = new Set(setlist.songIds);
    const sorted = [...songs].sort((a, b) => compareText(a.title, b.title) || compareText(a.artist, b.artist));
    const picked = await pickDialog({
      title: `“${setlist.name}” setlistine ekle`,
      items: sorted.map((song) => ({ id: song.id, label: song.title, sublabel: inSet.has(song.id) ? `${song.artist ? `${song.artist} · ` : ''}setlistte` : song.artist, disabled: inSet.has(song.id) })),
      emptyText: 'Henüz kayıtlı şarkı yok.',
    });
    if (!picked?.length) return;
    if (await save({ songIds: [...setlist.songIds, ...picked] })) {
      showMessage(`${picked.length} şarkı eklendi.`);
    }
  }

  function toggleEditing() {
    editing = !editing;
    render();
    root.querySelector('#setlist-edit')?.focus();
  }

  async function move(songId, delta) {
    const ids = setlist.songIds.filter((id) => songsById.has(id));
    const index = ids.indexOf(songId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    if (await save({ songIds: ids })) {
      render();
      const row = root.querySelector(`.set-song[data-id="${CSS.escape(songId)}"]`);
      const button = row?.querySelector(`[data-action="${delta < 0 ? 'up' : 'down'}"]`);
      (button && !button.disabled ? button : row?.querySelector('[data-action="remove"]'))?.focus();
    }
  }

  async function removeSong(song) {
    const ids = setlist.songIds.filter((id) => id !== song.id);
    if (await save({ songIds: ids })) {
      if (!ids.some((id) => songsById.has(id))) editing = false;
      render();
      showMessage(`“${song.title}” setlistten çıkarıldı.`);
    }
  }

  async function rename() {
    const updated = await nameDialog({
      title: 'Setlistin adı',
      label: 'Setlist adı',
      value: setlist.name,
      submit: (name) => actions.updateSetlist(setlist.id, { name }),
    });
    if (updated) {
      setlist = updated;
      render();
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `“${setlist.name}” silinsin mi?`,
      message: 'Setlistteki şarkılar silinmez; yalnızca bu liste silinir.',
      confirmLabel: 'Setlisti sil',
      danger: true,
    });
    if (!ok) return;
    try {
      await actions.deleteSetlist(setlist.id);
      showMessage(`“${setlist.name}” silindi.`);
      actions.onDeleted();
    } catch (error) {
      showMessage(describeStorageError(error), { tone: 'error' });
    }
  }

  return {
    show(nextSetlist, allSongs) {
      if (nextSetlist?.id !== setlist?.id) editing = false;
      setlist = nextSetlist;
      songs = allSongs;
      songsById = new Map(allSongs.map((song) => [song.id, song]));
      render();
    },
    /** Veriler değişince (ör. bir şarkı silindi) yeniden çizer. */
    update(nextSetlist, allSongs) {
      setlist = nextSetlist;
      songs = allSongs;
      songsById = new Map(allSongs.map((song) => [song.id, song]));
      // Odak, yeniden çizimden sonra aynı yerde kalsın (aynı satırın aynı düğmesi ya da aynı kimlikli öğe).
      const active = document.activeElement;
      const rowId = active?.closest?.('.set-song')?.dataset.id;
      const action = active?.dataset?.action;
      const focusedId = active?.id;
      render();
      if (rowId && action) {
        const row = root.querySelector(`.set-song[data-id="${CSS.escape(rowId)}"]`);
        const button = row?.querySelector(`[data-action="${action}"]`);
        (button && !button.disabled ? button : row?.querySelector('[data-action="remove"]'))?.focus();
      } else if (focusedId && root.contains(active) === false) {
        document.getElementById(focusedId)?.focus();
      }
    },
    get id() {
      return setlist?.id ?? null;
    },
  };
}
