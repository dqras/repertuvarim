/**
 * Ekranlar arası geçiş (yönlendirme).
 * Adres çubuğunda # işaretinden sonra gelen kısım hangi ekranın açılacağını belirler:
 *   #/             şarkı listesi
 *   #/sarki/<id>   bir şarkının ekranı
 *   #/yeni         yeni şarkı
 *   #/durum        uygulamanın durumu
 * # kullanıldığı için geçişler sunucuya gitmez; internetsiz de çalışır ve
 * tarayıcının geri tuşu beklendiği gibi davranır.
 */

/**
 * routes: [{ pattern: /^\/sarki\/(?<id>[^/]+)$/, show: (params) => {...} }, ...]
 * Hiçbiri uymazsa onUnknown(path) çağrılır.
 */
export function startRouter(routes, onUnknown) {
  const resolve = () => {
    const path = currentPath();
    for (const route of routes) {
      const match = route.pattern.exec(path);
      if (match) {
        route.show(match.groups ?? {});
        return;
      }
    }
    onUnknown?.(path);
  };
  window.addEventListener('hashchange', resolve);
  resolve();
}

/** Şu anki ekranın yolu, ör. "/sarki/s01". */
export function currentPath() {
  let path = location.hash.replace(/^#/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // Bozuk bir adres yazıldıysa olduğu gibi kullan.
  }
  return path || '/';
}

/** Başka bir ekrana geçer. replace: true ise geri tuşu geçmişine yeni kayıt eklemez. */
export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (replace) location.replace(target);
  else location.hash = target;
}
