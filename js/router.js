/**
 * Ekranlar arası geçiş (yönlendirme).
 * Adres çubuğunda # işaretinden sonra gelen kısım hangi ekranın açılacağını belirler:
 *   #/                     şarkı listesi
 *   #/sarki/<id>           bir şarkının ekranı
 *   #/sarki/<id>/duzenle   şarkıyı düzenleme
 *   #/yeni                 yeni şarkı
 *   #/durum                uygulamanın durumu
 * # kullanıldığı için geçişler sunucuya gitmez; internetsiz de çalışır ve
 * tarayıcının geri tuşu beklendiği gibi davranır.
 *
 * Uygulama, tarayıcı geçmişindeki her kayda "derinlik" yazar (0 = uygulamanın ilk
 * açıldığı ekran). Böylece geri düğmesi, geride uygulamaya ait bir ekran varsa ona
 * döner; yoksa (ör. bağlantıdan doğrudan açıldıysa) bir üst ekrana gider.
 */

let depth = 0;
let started = false;
let replacing = false;
let lastPath = null; // bir önceki ekranın yolu

/**
 * routes: [{ pattern: /^\/sarki\/(?<id>[^/]+)$/, show: (params) => {...} }, ...]
 * Hiçbiri uymazsa onUnknown(path) çağrılır.
 */
export function startRouter(routes, onUnknown) {
  const resolve = () => {
    rememberDepth();
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

function rememberDepth() {
  const state = history.state;
  if (state && typeof state.depth === 'number') {
    depth = state.depth; // geri/ileri ile dönülen ya da yenilenen bir kayıt
  } else {
    const isNew = started && !replacing;
    if (isNew) depth += 1; // yeni açılan ekran
    // "from": bu ekrana hangi ekrandan gelindi (geri dönülecek yer orası mı diye bakmak için)
    const from = isNew ? lastPath : state?.from ?? null;
    history.replaceState({ ...(state ?? {}), depth, from }, '');
  }
  started = true;
  replacing = false;
  lastPath = currentPath();
}

/** Tarayıcı geçmişinde bir önceki ekranın yolu (biliniyorsa). */
export function previousPath() {
  return history.state?.from ?? null;
}

/** Geride uygulamaya ait bir ekran var mı? */
export function canGoBack() {
  return depth > 0;
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
  if (location.hash === target) return; // zaten bu ekrandayız
  if (replace) {
    replacing = true;
    location.replace(target);
  } else {
    location.hash = target;
  }
}
