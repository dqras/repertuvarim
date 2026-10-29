/**
 * Şarkı ve kategori verisinin biçimi.
 * Veritabanından (ve ileride yedek dosyasından) gelen her kayıt buradan geçer;
 * eksik ya da hatalı alanlar güvenli varsayılan değerlerle doldurulur.
 * Bu dosya ekranlardan bağımsızdır; tests/model.test.mjs ile test edilir.
 */

const toText = (value) => (value === null || value === undefined ? '' : String(value));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Bir şarkının alanları:
 *   id, title (ad), artist (sanatçı), key (orijinal ton), categoryIds (kategoriler),
 *   capo, bpm (tempo), notes (kişisel notlar), favorite (favori mi),
 *   content (söz ve akorlar), isSample (örnek şarkı mı),
 *   createdAt / updatedAt (eklenme / değişme zamanı, milisaniye)
 */
export function normalizeSong(raw = {}) {
  const createdAt = isNumber(raw.createdAt) ? raw.createdAt : Date.now();
  return {
    id: toText(raw.id),
    title: toText(raw.title).trim(),
    artist: toText(raw.artist).trim(),
    key: toText(raw.key).trim(),
    categoryIds: Array.isArray(raw.categoryIds)
      ? [...new Set(raw.categoryIds.map(toText).filter(Boolean))]
      : [],
    capo: isNumber(raw.capo) && raw.capo > 0 ? raw.capo : 0,
    bpm: isNumber(raw.bpm) && raw.bpm > 0 ? raw.bpm : null,
    notes: toText(raw.notes),
    favorite: raw.favorite === true,
    content: toText(raw.content),
    isSample: raw.isSample === true,
    createdAt,
    updatedAt: isNumber(raw.updatedAt) ? raw.updatedAt : createdAt,
  };
}

/** Bir kategorinin alanları: id, name (ad), color (renk adı), order (sıra), createdAt. */
export function normalizeCategory(raw = {}, fallbackOrder = 0) {
  return {
    id: toText(raw.id),
    name: toText(raw.name).trim(),
    color: toText(raw.color) || 'slate',
    order: isNumber(raw.order) ? raw.order : fallbackOrder,
    createdAt: isNumber(raw.createdAt) ? raw.createdAt : Date.now(),
  };
}
