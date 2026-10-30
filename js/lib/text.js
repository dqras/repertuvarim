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

/**
 * Metni Türkçe harfleri bozulmadan saklanacak hâle getirir:
 *  - harfler birleşik biçime çevrilir (NFC): "I" + üst nokta → "İ";
 *  - başka dillere göre küçültülmüş "İ" harfinden kalan fazladan nokta silinir
 *    ("i̇stanbul" → "istanbul"). Böylece akor hizası ve arama doğru çalışır.
 */
export function cleanText(text) {
  return String(text ?? '').normalize('NFC').replace(/([iıjI])\u0307/g, (_, letter) => (letter === 'I' ? 'İ' : letter === 'ı' ? 'i' : letter));
}

/**
 * Yazılan bir adı karşılaştırmak için sadeleştirir: Türkçe küçük harfe çevrilir ve
 * noktalı/noktasız i farkı kaldırılır. "SI", "Sİ", "sı", "si" → "si"; "MİNÖR", "MINÖR" → "minör".
 */
export function foldLetters(text) {
  return cleanText(text).toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/\u0307/g, '');
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

/** Bayt cinsinden büyüklüğü okunur hâle getirir: 86016 → "84 KB". */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, Number(bytes) || 0);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

/**
 * Aranan kelimelerin hepsi metinde geçiyorsa true döner.
 * İki değer de önceden foldForSearch ile sadeleştirilmiş olmalıdır.
 */
export function matchesQuery(foldedText, foldedQuery) {
  if (!foldedQuery) return true;
  return foldedQuery.split(' ').every((word) => foldedText.includes(word));
}
