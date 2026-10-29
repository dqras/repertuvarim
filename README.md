# Repertuvarım

Kişisel şarkı repertuvarı ve akor uygulaması. Telefona ve bilgisayara kurulabilen, internetsiz çalışan bir web uygulamasıdır (PWA).

Adres: https://dqras.github.io/repertuvarim/

## Dosyalar

| Dosya | Görevi |
|---|---|
| `index.html` | Uygulamanın sayfası |
| `css/styles.css` | Görünüm: renkler, yazılar, yerleşim |
| `js/app.js` | Başlangıç noktası; ekranı hazırlar |
| `js/pwa.js` | Kurulum, güncelleme ve bağlantı durumu |
| `sw.js` | Service worker: dosyaları cihaza kaydeder, uygulamanın internetsiz açılmasını sağlar |
| `manifest.webmanifest` | Uygulamanın adı, simgesi ve renkleri |
| `icons/` | Uygulama simgeleri |

## Yeni sürüm yayınlarken

1. Değişen dosyaları yükleyin.
2. `sw.js` içindeki `VERSION` değerini artırın (ör. `0.3.0` → `0.4.0`).
3. Projeye yeni dosya eklendiyse `sw.js` içindeki `APP_FILES` listesine de ekleyin.

Cihazlar yeni sürümü fark edince uygulamada "Yeni sürüm hazır" bildirimi çıkar.

## Veriler

Şarkılar sunucuya gönderilmez; yalnızca kullanıldığı cihazda saklanır.
