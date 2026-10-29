/**
 * Veri erişimi: ekranlar şarkılara ve kategorilere yalnızca bu dosya üzerinden ulaşır.
 *
 * 4. aşamada veriler örnek listeden gelir ve yalnızca bellekte durur.
 * 5. aşamada bu dosyanın içi cihazdaki veritabanıyla (IndexedDB) değiştirilecek;
 * ekranların kullandığı fonksiyonlar (listSongs, getSong, listCategories) aynı kalacak.
 */
import { DEFAULT_CATEGORIES } from './defaults.js';
import { SAMPLE_SONGS } from './sample-songs.js';

/** Örnek veri kullanıldığını ekranda belirtmek için. */
export const usesSampleData = true;

// Ekranlar aldıkları kopyayı değiştirse bile asıl veri bozulmasın diye kopya verilir.
const copy = (value) => structuredClone(value);

export async function listSongs() {
  return copy(SAMPLE_SONGS);
}

export async function getSong(id) {
  const found = SAMPLE_SONGS.find((song) => song.id === id);
  return found ? copy(found) : null;
}

export async function listCategories() {
  return DEFAULT_CATEGORIES.map((category, order) => ({ ...category, order }));
}
