/**
 * ÖRNEK VERİLER — yalnızca 4. aşama için.
 * Şarkı adları ve sanatçılar uydurmadır; listenin görünümünü, aramayı ve
 * sıralamayı denemek için hazırlanmıştır. Gerçek kayıt 5. aşamada gelecek.
 *
 * Bir şarkının alanları:
 *   id, title (ad), artist (sanatçı), key (orijinal ton), categoryIds (kategoriler),
 *   capo, bpm (tempo), notes (kişisel notlar), favorite (favori mi),
 *   content (söz ve akorlar), createdAt / updatedAt (eklenme / değişme zamanı)
 */

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 1); // 1 Ekim 2026

function song(id, title, artist, key, categoryIds, extra = {}) {
  const createdAt = START + (extra.addedOnDay ?? 0) * DAY;
  return {
    id,
    title,
    artist,
    key,
    categoryIds,
    capo: extra.capo ?? 0,
    bpm: extra.bpm ?? null,
    notes: extra.notes ?? '',
    favorite: extra.favorite ?? false,
    content: '',
    createdAt,
    updatedAt: createdAt,
  };
}

export const SAMPLE_SONGS = [
  song('s01', 'Ayrılık Rüzgârı', 'Selim Kaya', 'Am', ['arabesk', 'akustik'], {
    favorite: true, bpm: 76, addedOnDay: 3, notes: 'Girişte iki ölçü bekle.',
  }),
  song('s02', 'Sahilde Son Akşam', 'Mavi Kervan', 'G', ['pop'], { addedOnDay: 11 }),
  song('s03', 'Kırık Plak', 'Eski Plak', 'Em', ['rock', 'alternatif'], { bpm: 128, addedOnDay: 7 }),
  song('s04', 'Bozkırın Ortasında', 'Anonim', 'Dm', ['thm'], { capo: 2, addedOnDay: 1 }),
  song('s05', 'Sensiz Geçen Yıllar', 'Selim Kaya', 'Bm', ['arabesk'], { favorite: true, addedOnDay: 14 }),
  song('s06', 'Akşam Güneşi', 'Nur Erden', 'F#m', ['tsm'], { addedOnDay: 5 }),
  song('s07', 'Yağmur Sonrası', 'Ayaz Sokağı', 'C#m', ['alternatif'], { addedOnDay: 16 }),
  song('s08', 'Liman', 'Mavi Kervan', 'D', ['pop', 'akustik'], { bpm: 96, addedOnDay: 9 }),
  song('s09', 'Çınar Altında', 'Anonim', 'Am', ['thm', 'akustik'], { capo: 3, addedOnDay: 2 }),
  song('s10', 'Gece Lambası', 'Deniz Ufuk', 'Bb', ['pop'], { favorite: true, addedOnDay: 18 }),
  song('s11', 'Duvar', 'Kuzey Rüzgârı', 'E', ['rock'], { bpm: 140, addedOnDay: 6 }),
  song('s12', "İstanbul'da Sonbahar", 'Nur Erden', 'Gm', ['tsm'], { addedOnDay: 12 }),
  song('s13', 'Üşüyen Kalpler', 'Selim Kaya', 'Cm', ['arabesk'], { addedOnDay: 4 }),
  song('s14', 'Şehrin Işıkları', 'Ayaz Sokağı', 'F', ['alternatif', 'rock'], { addedOnDay: 15 }),
  song('s15', 'Özlem', 'Deniz Ufuk', 'A', ['akustik'], { addedOnDay: 8 }),
  song('s16', 'Çay Ocağı', 'Eski Plak', 'Ab', ['diger'], { addedOnDay: 10 }),
  song('s17', 'Ilık Rüzgâr', 'Kuzey Rüzgârı', 'Eb', ['pop'], { addedOnDay: 13 }),
  song('s18', 'Gülümse Biraz', 'Nur Erden', 'C', ['pop', 'akustik', 'alternatif'], {
    favorite: true, addedOnDay: 17,
  }),
];
