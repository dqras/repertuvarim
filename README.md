# Repertuvarım

Kişisel şarkı repertuvarı ve akor uygulaması. Telefona ve bilgisayara kurulabilen, internetsiz çalışan bir web uygulamasıdır (PWA).

Adres: https://dqras.github.io/repertuvarim/

## Dosyalar

| Dosya | Görevi |
|---|---|
| `index.html` | Uygulamanın sayfası ve ekranların iskeleti |
| `css/styles.css` | Görünüm: renkler, yazılar, yerleşim |
| `js/app.js` | Başlangıç noktası; verileri yükler, ekranları hazırlar |
| `js/router.js` | Ekranlar arası geçiş (`#/`, `#/sarki/…`, `#/yeni`, `#/durum`) |
| `js/pwa.js` | Kurulum, güncelleme ve bağlantı durumu |
| `js/data/repository.js` | Veri erişimi: ekranlar şarkılara yalnızca buradan ulaşır |
| `js/data/defaults.js` | İlk kurulumda gelen kategoriler |
| `js/data/sample-songs.js` | Örnek şarkılar (yalnızca 4. aşama için, uydurma) |
| `js/lib/text.js` | Türkçeye uygun arama ve sıralama |
| `js/lib/dom.js` | Küçük arayüz yardımcıları ve simgeler |
| `js/views/` | Ekranlar: şarkı listesi, şarkı ekranı, durum |
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

Şarkılar sunucuya gönderilmez; yalnızca kullanıldığı cihazda saklanır.
