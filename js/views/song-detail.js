/**
 * Şarkı ekranı.
 * Şarkının bilgilerini, favori ve düzenle düğmelerini ve kaydedilmiş söz ve
 * akorları gösterir. Akorların sözlerin üstünde gösterilmesi, transpoze ve yazı
 * boyutu düğmeleri 8. aşamada eklenecek.
 */
import { el, icon } from '../lib/dom.js';
import { categoryTag } from './components.js';

/**
 * Şarkıyı root içine çizer. Şarkı yoksa anlaşılır bir mesaj gösterir.
 * onToggleFavorite(song): favori düğmesine basılınca çağrılır; güncel şarkıyı
 * döndürmeli, kaydedilemezse hata fırlatmalıdır.
 */
export function renderSongDetail(root, song, categoryById, { onToggleFavorite } = {}) {
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

  const favoriteButton = el('button', { type: 'button', class: 'fav-toggle' });
  const showFavorite = (favorite) => {
    favoriteButton.setAttribute('aria-pressed', String(favorite));
    favoriteButton.replaceChildren(
      icon(favorite ? 'star' : 'starOutline'),
      favorite ? 'Favorilerde' : 'Favorilere ekle'
    );
  };
  showFavorite(song.favorite);
  favoriteButton.addEventListener('click', async () => {
    favoriteButton.disabled = true;
    try {
      const updated = await onToggleFavorite?.(song);
      if (updated) {
        song.favorite = updated.favorite;
        showFavorite(song.favorite);
      }
    } catch {
      // Hata mesajını uygulama gösterir; düğme eski hâlinde kalır.
    } finally {
      favoriteButton.disabled = false;
    }
  });

  const editLink = el(
    'a',
    { class: 'pill-link', id: 'edit-song', href: `#/sarki/${encodeURIComponent(song.id)}/duzenle` },
    icon('edit'),
    'Düzenle'
  );

  root.replaceChildren(
    el(
      'article',
      { class: 'page page--screen song-detail' },
      el(
        'header',
        { class: 'song-detail__header' },
        el('h1', { class: 'screen-title', tabindex: '-1', text: song.title }),
        el('p', { class: 'song-detail__artist', text: song.artist || 'Sanatçı belirtilmemiş' }),
        el('div', { class: 'song-detail__actions' }, favoriteButton, editLink),
        song.isSample ? el('p', { class: 'song-detail__sample', text: 'Örnek şarkı' }) : null
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
            el('p', { class: 'song-detail__notes-text', text: song.notes })
          )
        : null,
      song.content.trim()
        ? el(
            'section',
            { class: 'song-detail__content' },
            el('h2', { class: 'section-title', text: 'Söz ve akorlar' }),
            el('p', { class: 'field__hint', text: 'Akorlar 8. aşamada sözlerin üstünde gösterilecek; şimdilik yazdığınız gibi görünüyor.' }),
            el('pre', { class: 'raw-content', text: song.content })
          )
        : el(
            'p',
            { class: 'placeholder' },
            'Bu şarkıya henüz söz ve akor eklenmedi. ',
            el('a', { href: `#/sarki/${encodeURIComponent(song.id)}/duzenle` }, 'Düzenle'),
            ' ile ekleyebilirsiniz.'
          )
    )
  );
}
