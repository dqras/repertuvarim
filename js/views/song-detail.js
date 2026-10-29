/**
 * Şarkı ekranı.
 *
 * - Akorlar sarı ve sözlerin üstünde (çizim: js/music/render.js).
 * - Alt çubuk: bir yarım ses aşağı/yukarı, ton seçimi, yazıyı küçült/büyüt.
 * - Taşınmışsa üstte "orijinal tona dön" düğmesi ve yeni ton görünür.
 * - Seçilen transpoze şarkıya özel, yazı boyutu bütün şarkılar için hatırlanır.
 * - "Ekran açık" seçiliyse şarkı ekranındayken telefonun ekranı kararmaz.
 * Kayıtlı şarkıya hiçbir zaman dokunulmaz; taşıma yalnızca görüntüdedir.
 */
import { el, icon } from '../lib/dom.js';
import { keysLike, normalizeSteps, parseKey, keyName } from '../music/chords.js';
import { guessKey, transposeContent } from '../music/song-text.js';
import { renderSongContent, watchLayout } from '../music/render.js';
import { categoryTag } from './components.js';

export const FONT_SCALE = { min: 0.8, max: 1.8, step: 0.1, fallback: 1 };

/**
 * root: #view-song. options:
 *   categoryById                      kategori adları ve renkleri
 *   onToggleFavorite(song) → şarkı    favori düğmesi
 *   loadPrefs(songId) → { steps, scale, keepAwake }
 *   savePref(name, value, songId)     name: 'steps' | 'scale' | 'keepAwake'
 */
export function createSongView(root, { categoryById, onToggleFavorite, loadPrefs, savePref }) {
  let current = null; // { song, steps, scale, keepAwake, layout, ui }
  let wakeLock = null;

  async function show(song) {
    hide();
    if (!song) {
      renderMissing();
      return;
    }
    const prefs = await loadPrefs(song.id);
    current = {
      song,
      sourceKey: song.key || guessKey(song.content),
      steps: normalizeSteps(prefs.steps ?? 0),
      scale: clampScale(prefs.scale ?? FONT_SCALE.fallback),
      keepAwake: prefs.keepAwake === true,
    };
    renderSong();
    if (current.keepAwake) requestWakeLock();
  }

  /** Ekrandan çıkarken: yerleşim izleme ve ekran kilidi bırakılır. */
  function hide() {
    current?.layout?.stop();
    releaseWakeLock();
    current = null;
  }

  function renderMissing() {
    root.replaceChildren(
      el(
        'div',
        { class: 'page page--screen' },
        el('h1', { class: 'screen-title', tabindex: '-1', text: 'Şarkı bulunamadı' }),
        el('p', { class: 'muted', text: 'Bu şarkı silinmiş ya da adres yanlış yazılmış olabilir.' }),
        el('a', { class: 'button button--quiet', href: '#/' }, 'Şarkı listesine dön')
      )
    );
  }

  // --- Çizim -------------------------------------------------------------------

  function renderSong() {
    const { song } = current;
    const ui = {};
    const editHref = `#/sarki/${encodeURIComponent(song.id)}/duzenle`;

    ui.favorite = el('button', { type: 'button', class: 'fav-toggle', id: 'song-favorite' });
    ui.favorite.addEventListener('click', toggleFavorite);
    ui.awake = 'wakeLock' in navigator
      ? el('button', { type: 'button', class: 'fav-toggle fav-toggle--plain', id: 'song-awake', title: 'Bu ekrandayken telefonun ekranı kararmaz' })
      : null;
    ui.awake?.addEventListener('click', toggleAwake);

    const meta = [
      song.key ? el('span', { class: 'song-meta__item' }, 'Orijinal ton ', el('strong', { class: 'song-meta__key', text: song.key })) : null,
      song.capo ? el('span', { class: 'song-meta__item', text: `Kapo ${song.capo}` }) : null,
      song.bpm ? el('span', { class: 'song-meta__item', text: `${song.bpm} BPM` }) : null,
    ].filter(Boolean);
    const songCategories = song.categoryIds.map((id) => categoryById.get(id)).filter(Boolean);

    ui.status = el('div', { class: 'transpose-status', id: 'transpose-status', 'aria-live': 'polite' });
    ui.warning = el('p', { class: 'field__warning', id: 'transpose-warning', hidden: true });
    ui.text = el('div', { class: 'song-text', id: 'song-text' });

    ui.down = el('button', { type: 'button', class: 'bar-button', id: 'transpose-down', 'aria-label': 'Bir yarım ses aşağı' }, icon('minus'));
    ui.up = el('button', { type: 'button', class: 'bar-button', id: 'transpose-up', 'aria-label': 'Bir yarım ses yukarı' }, icon('plus'));
    ui.key = el('select', { class: 'bar-key', id: 'transpose-key', 'aria-label': 'Ton seç' });
    ui.smaller = el('button', { type: 'button', class: 'bar-button bar-button--text', id: 'font-smaller', 'aria-label': 'Yazıyı küçült' }, el('span', { class: 'bar-a bar-a--small', text: 'A' }));
    ui.bigger = el('button', { type: 'button', class: 'bar-button bar-button--text', id: 'font-bigger', 'aria-label': 'Yazıyı büyüt' }, el('span', { class: 'bar-a', text: 'A' }));
    ui.down.addEventListener('click', () => setSteps(current.steps - 1));
    ui.up.addEventListener('click', () => setSteps(current.steps + 1));
    ui.key.addEventListener('change', () => setSteps(Number(ui.key.value)));
    ui.smaller.addEventListener('click', () => setScale(current.scale - FONT_SCALE.step));
    ui.bigger.addEventListener('click', () => setScale(current.scale + FONT_SCALE.step));

    const hasContent = song.content.trim() !== '';
    root.replaceChildren(
      el(
        'article',
        { class: 'page page--screen song-view' },
        el(
          'header',
          { class: 'song-view__header' },
          el('h1', { class: 'screen-title', tabindex: '-1', text: song.title }),
          el('p', { class: 'song-detail__artist', text: song.artist || 'Sanatçı belirtilmemiş' }),
          meta.length || songCategories.length
            ? el('div', { class: 'song-meta' }, meta, songCategories.map(categoryTag))
            : null,
          el(
            'div',
            { class: 'song-detail__actions' },
            ui.favorite,
            el('a', { class: 'pill-link', id: 'edit-song', href: editHref }, icon('edit'), 'Düzenle'),
            ui.awake
          ),
          song.isSample ? el('p', { class: 'song-detail__sample', text: 'Örnek şarkı' }) : null
        ),
        song.notes
          ? el('details', { class: 'song-notes' }, el('summary', { text: 'Notlarım' }), el('p', { class: 'song-detail__notes-text', text: song.notes }))
          : null,
        hasContent ? ui.status : null,
        hasContent ? ui.warning : null,
        hasContent
          ? ui.text
          : el('p', { class: 'placeholder' }, 'Bu şarkıya henüz söz ve akor eklenmedi. ', el('a', { href: editHref }, 'Düzenle'), ' ile ekleyebilirsiniz.')
      ),
      el(
        'div',
        { class: 'song-bar', role: 'toolbar', 'aria-label': 'Ton ve yazı boyutu' },
        el('div', { class: 'song-bar__inner' },
          el('div', { class: 'song-bar__group' }, ui.down, ui.key, ui.up),
          el('div', { class: 'song-bar__group' }, ui.smaller, ui.bigger))
      )
    );

    current.ui = ui;
    showFavorite();
    showAwake();
    applyScale();
    drawText();
    current.layout = hasContent ? watchLayout(ui.text) : null;
  }

  /** Sözleri ve akorları güncel transpozeyle çizer; çubuk ve durum yazısını günceller. */
  function drawText() {
    const { song, steps, sourceKey, ui } = current;
    const canTranspose = Boolean(sourceKey) && song.content.includes('[');
    const result = transposeContent(song.content, canTranspose ? steps : 0, { key: sourceKey });
    if (song.content.trim()) renderSongContent(ui.text, result.text);

    // Ton seçimi: 12 ton, orijinal işaretli
    ui.key.replaceChildren();
    if (canTranspose) {
      const source = parseKey(sourceKey);
      const names = keysLike(sourceKey);
      for (let offset = -5; offset <= 6; offset += 1) {
        const name = names[(((source.pitch + offset) % 12) + 12) % 12];
        const label = offset === 0 ? `${name} · orijinal` : `${name} · ${offset > 0 ? '+' : '−'}${Math.abs(offset)}`;
        ui.key.append(el('option', { value: String(offset), selected: offset === steps }, label));
      }
    } else {
      ui.key.append(el('option', { value: '0', text: 'Ton yok' }));
    }
    for (const control of [ui.down, ui.up, ui.key]) control.disabled = !canTranspose;

    // Durum: yalnızca taşınmışken görünür
    if (canTranspose && steps !== 0) {
      const source = parseKey(sourceKey);
      const now = keyName(source.pitch + steps, source.minor);
      const direction = steps > 0 ? 'yukarı' : 'aşağı';
      ui.status.replaceChildren(
        el('p', { class: 'transpose-status__text' },
          'Şimdiki ton ', el('strong', { class: 'song-meta__key', text: now }),
          ` · orijinalden ${Math.abs(steps)} yarım ses ${direction}`),
        el('button', { type: 'button', class: 'button button--quiet button--small', id: 'transpose-reset', onclick: () => setSteps(0) },
          icon('reset'), 'Orijinal tona dön')
      );
      ui.status.hidden = false;
    } else {
      ui.status.replaceChildren();
      ui.status.hidden = true;
    }

    const unknown = steps !== 0 ? result.unknown : [];
    ui.warning.textContent = unknown.length
      ? `Şu akorlar tanınmadığı için değiştirilmedi: ${unknown.slice(0, 6).join(', ')}.`
      : '';
    ui.warning.hidden = unknown.length === 0;
  }

  // --- Ayarlar -------------------------------------------------------------------

  function setSteps(value) {
    if (!current) return;
    const steps = normalizeSteps(value);
    if (steps === current.steps && value === steps) return;
    current.steps = steps;
    drawText();
    current.layout?.refresh();
    savePref('steps', steps, current.song.id);
  }

  function setScale(value) {
    if (!current) return;
    const scale = clampScale(value);
    if (scale === current.scale) return;
    current.scale = scale;
    applyScale();
    current.layout?.refresh();
    savePref('scale', scale);
  }

  function applyScale() {
    const { ui, scale } = current;
    root.style.setProperty('--song-scale', String(scale));
    ui.smaller.disabled = scale <= FONT_SCALE.min;
    ui.bigger.disabled = scale >= FONT_SCALE.max;
  }

  // --- Favori ve ekran açık ----------------------------------------------------------

  function showFavorite() {
    const { favorite } = current.song;
    current.ui.favorite.setAttribute('aria-pressed', String(favorite));
    current.ui.favorite.replaceChildren(icon(favorite ? 'star' : 'starOutline'), favorite ? 'Favorilerde' : 'Favorilere ekle');
  }

  async function toggleFavorite() {
    const view = current;
    view.ui.favorite.disabled = true;
    try {
      const updated = await onToggleFavorite(view.song);
      if (updated && current === view) {
        view.song.favorite = updated.favorite;
        showFavorite();
      }
    } catch {
      // Hata mesajını uygulama gösterir.
    } finally {
      view.ui.favorite.disabled = false;
    }
  }

  function showAwake() {
    const button = current?.ui.awake;
    if (!button) return;
    const on = current.keepAwake && wakeLock !== null;
    button.setAttribute('aria-pressed', String(current.keepAwake));
    button.replaceChildren(icon('sun'), current.keepAwake ? 'Ekran açık' : 'Ekran açık kalsın');
    button.classList.toggle('is-waiting', current.keepAwake && !on);
  }

  async function toggleAwake() {
    current.keepAwake = !current.keepAwake;
    savePref('keepAwake', current.keepAwake);
    if (current.keepAwake) await requestWakeLock();
    else releaseWakeLock();
    showAwake();
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        showAwake();
      });
    } catch (error) {
      console.warn('Ekran açık tutulamadı:', error);
      wakeLock = null;
    }
    showAwake();
  }

  function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    lock?.release().catch(() => {});
  }

  // Telefon kilitlenip açılınca ekran kilidi kendiliğinden bırakılır; yeniden istenir.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && current?.keepAwake) requestWakeLock();
  });

  return { show, hide };
}

function clampScale(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  if (!Number.isFinite(rounded)) return FONT_SCALE.fallback;
  return Math.min(FONT_SCALE.max, Math.max(FONT_SCALE.min, rounded));
}
