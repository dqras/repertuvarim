/**
 * Birden fazla ekranda kullanılan küçük arayüz parçaları.
 */
import { el } from '../lib/dom.js';

/** Kategori etiketi: kategorinin renginde bir nokta ve adı. */
export function categoryTag(category) {
  return el('span', { class: 'cat-tag', dataset: { color: category.color } }, category.name);
}
