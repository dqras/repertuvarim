/**
 * Şarkı ekranı.
 * 4. aşamada şarkının temel bilgilerini gösterir. Sözler, akorlar, transpoze ve
 * yazı boyutu düğmeleri 8. aşamada eklenecek.
 */
import { el, icon } from '../lib/dom.js';
import { categoryTag } from './components.js';

/** Şarkıyı root içine çizer. Şarkı yoksa anlaşılır bir mesaj gösterir. */
export function renderSongDetail(root, song, categoryById) {
  if (!song) {
    root.replaceChildren(
      el(
        'div',
        { class: 'page page--screen' },
        el('h1', { class: 'screen-title', tabindex: '-1', text: 'Şarkı bulunamadı' }),
        el('p', { class: 'muted', text: 'Bu şarkı silinmiş ya da adres yanlış yazılmış olabilir.' }),
        el('a', { class: 'button button--quiet', href: '#/' }, 'Şarkı listesine dön')
      )
    );
    return;
  }

  const facts = [
    { label: 'Orijinal ton', value: song.key, isKey: true },
    { label: 'Kapo', value: song.capo ? `${song.capo}. perde` : null },
    { label: 'Tempo', value: song.bpm ? `${song.bpm} BPM` : null },
  ].filter((fact) => fact.value);

  const songCategories = song.categoryIds.map((id) => categoryById.get(id)).filter(Boolean);

  root.replaceChildren(
    el(
      'article',
      { class: 'page page--screen song-detail' },
      el(
        'header',
        { class: 'song-detail__header' },
        el('h1', { class: 'screen-title', tabindex: '-1', text: song.title }),
        el('p', { class: 'song-detail__artist', text: song.artist || 'Sanatçı belirtilmemiş' }),
        song.favorite ? el('p', { class: 'song-detail__fav' }, icon('star'), 'Favorilerde') : null
      ),
      facts.length
        ? el(
            'dl',
            { class: 'facts' },
            facts.map((fact) =>
              el(
                'div',
                { class: 'facts__item' },
                el('dt', { text: fact.label }),
                el('dd', { class: fact.isKey ? 'facts__value facts__value--key' : 'facts__value', text: fact.value })
              )
            )
          )
        : null,
      songCategories.length ? el('div', { class: 'song-detail__cats' }, songCategories.map(categoryTag)) : null,
      song.notes
        ? el(
            'section',
            { class: 'song-detail__notes' },
            el('h2', { class: 'section-title', text: 'Notlarım' }),
            el('p', { text: song.notes })
          )
        : null,
      el('p', { class: 'placeholder', text: 'Sözler ve akorlar 8. aşamada bu alanda gösterilecek.' })
    )
  );
}
