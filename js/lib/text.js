/**
 * Türkçeye uygun metin yardımcıları: sıralama ve arama.
 * Bu dosya ekranlardan bağımsızdır; tests/text.test.mjs ile test edilir.
 */

const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });

/**
 * İki metni Türk alfabesi sırasına göre karşılaştırır
 * (Ç, Ğ, I, İ, Ö, Ş, Ü doğru yerlerinde; büyük/küçük harf fark etmez).
 */
export function compareText(a, b) {
  return collator.compare(a ?? '', b ?? '');
}

const TURKISH_LETTERS = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/**
 * Metni aramaya uygun hâle getirir: küçük harf, Türkçe harfler sade karşılıklarına
 * çevrilir, fazla boşluklar silinir. Böylece "ruzgar", "RÜZGÂR" ve "Rüzgâr" aynı sonucu bulur.
 */
export function foldForSearch(text) {
  return String(text ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (letter) => TURKISH_LETTERS[letter])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aranan kelimelerin hepsi metinde geçiyorsa true döner.
 * İki değer de önceden foldForSearch ile sadeleştirilmiş olmalıdır.
 */
export function matchesQuery(foldedText, foldedQuery) {
  if (!foldedQuery) return true;
  return foldedQuery.split(' ').every((word) => foldedText.includes(word));
}
