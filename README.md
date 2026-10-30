# Repertuvarım

Kişisel şarkı repertuvarı ve akor uygulaması. Telefona ve bilgisayara kurulabilen, internetsiz çalışan bir web uygulamasıdır (PWA).

Adres: https://dqras.github.io/repertuvarim/

## Dosyalar

| Dosya | Görevi |
|---|---|
| `index.html` | Uygulamanın sayfası ve ekranların iskeleti |
| `css/styles.css` | Görünüm: renkler, yazılar, yerleşim |
| `js/app.js` | Başlangıç noktası; verileri yükler, ekranları hazırlar |
| `js/router.js` | Ekranlar arası geçiş (`#/`, `#/sarki/…`, `#/sarki/…/duzenle`, `#/yeni`, `#/aktar`, `#/durum`, `#/kategoriler`, `#/setlistler`, `#/setlist/…`, `#/favoriler`, `#/notalar`, `#/nota/…`) |
| `js/pwa.js` | Kurulum, güncelleme ve bağlantı durumu |
| `js/data/repository.js` | Veri erişimi: ekranlar şarkılara yalnızca buradan ulaşır |
| `js/data/db.js` | Cihazdaki veritabanı (IndexedDB), sürüm yükseltmeleri, kalıcı depolama izni |
| `js/data/model.js` | Şarkı, kategori ve setlist verisinin biçimi, ad denetimi ve varsayılanları |
| `js/data/defaults.js` | İlk kurulumda gelen kategoriler |
| `js/data/sample-songs.js` | Örnek şarkılar (uydurma; ilk açılışta bir kez eklenir) |
| `js/lib/text.js` | Türkçeye uygun arama ve sıralama |
| `js/music/chords.js` | Transpoze motoru: akorları tanıma, yarım ses taşıma, diyez/bemol, tonlar |
| `js/music/render.js` | Şarkıyı çizer: akorlar sözlerin üstünde, kelimeler bölünmeden |
| `js/music/bookmarklet.js` | repertuarim.com / akorlar.com'dan aktarma yer imi (kısa yükleyici) ve aktarma kodu |
| `aktar.js` | Yer iminin yüklediği aktarma kodu; `node tools/build-aktar.mjs` ile üretilir, elle değiştirilmez |
| `js/music/ocr.js` | Ekran görüntüsünü okuma: okuyucuyu (Tesseract) ilk kullanımda indirip saklar, görüntüyü hazırlar |
| `js/music/notation.js` | Nota motoru: tonlar ve donanımlar, nota kodu, süreler, ölçüler, donanımıyla birlikte transpoze |
| `js/music/staff.js` | Porte çizimi (SVG): anahtar, donanım, ölçü, süreleriyle notalar, suslar, ışınlar |
| `js/music/ocr-sheet.js` | Okunan yazıyı akor sayfasına çevirir: akorları görüntüde durdukları harfe yerleştirir |
| `js/music/song-text.js` | Şarkı metni: [Am] akorlarını bulma, bütün şarkıyı taşıma, ayrı satırdaki akorları [Am] biçimine çevirme |
| `js/lib/dom.js` | Küçük arayüz yardımcıları ve simgeler |
| `js/views/` | Ekranlar: şarkı listesi, şarkı ekranı, şarkı formu (ekleme/düzenleme), kategoriler, setlistler, notalar, durum, pencereler (onay, ad, seçim), ana ekrana ekleme |
| `tools/` | Geliştirme yardımcıları (aktar.js üretimi) |
| `sw.js` | Service worker: dosyaları cihaza kaydeder, uygulamanın internetsiz açılmasını sağlar |
| `manifest.webmanifest` | Uygulamanın adı, simgesi ve renkleri |
| `icons/` | Uygulama simgeleri |
| `tests/` | Otomatik testler (Node.js ile: `node --test`) |

## Yeni sürüm yayınlarken

1. Değişen dosyaları yükleyin.
2. `sw.js` içindeki `VERSION` değerini artırın (ör. `0.4.0` → `0.5.0`).
3. Projeye yeni dosya eklendiyse `sw.js` içindeki `APP_FILES` listesine de ekleyin.

Cihazlar yeni sürümü fark edince uygulamada "Yeni sürüm hazır" bildirimi çıkar.

## Veriler

Şarkılar sunucuya gönderilmez; yalnızca kullanıldığı cihazda, tarayıcının veritabanında
(IndexedDB) saklanır. Uygulama açılışta tarayıcıdan "kalıcı depolama" izni ister; izin
verilirse cihaz yer açmak için verileri kendiliğinden silmez. Tarayıcının site verileri
temizlenirse veriler silinir; bu yüzden düzenli yedek alınmalıdır.

Veritabanı yapısı değişeceği zaman `js/data/db.js` içindeki `UPGRADES` listesinin sonuna yeni
bir adım eklenir; eski adımlar değiştirilmez.
