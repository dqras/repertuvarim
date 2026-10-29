/**
 * Birden fazla ekranda kullanılan küçük arayüz parçaları.
 */
import { el } from '../lib/dom.js';

/** Kategori etiketi: kategorinin renginde bir nokta ve adı. */
export function categoryTag(category) {
  return el('span', { class: 'cat-tag', dataset: { color: category.color } }, category.name);
}

let messageTimer = 0;

/**
 * Ekranın üstünde kısa bir bilgi gösterir ve birkaç saniye sonra gizler.
 * tone: 'info' (bilgi) | 'error' (hata)
 */
export function showMessage(text, { tone = 'info', duration = 5000 } = {}) {
  const box = document.getElementById('message');
  if (!box) return;
  box.textContent = text;
  box.dataset.tone = tone;
  box.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    box.hidden = true;
  }, duration);
}
