/**
 * PWA yardımcıları
 * (PWA: telefona ve bilgisayara uygulama gibi kurulabilen web uygulaması)
 *
 * - registerServiceWorker: internetsiz çalışmayı sağlayan service worker'ı başlatır.
 * - activateUpdate:        bekleyen yeni sürümü devreye alır.
 * - askWorkerVersion:      çalışan sürümün numarasını sorar.
 * - watchConnection:       internet bağlantısı değişince haber verir.
 * - setupInstallButton:    "Uygulama olarak yükle" düğmesini yönetir (Chrome ve Edge).
 */

// Uygulama açık kaldıkça saatte bir yeni sürüm olup olmadığına bakılır.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Service worker'ı kaydeder.
 * onUpdateReady(worker): yeni sürüm indirildi ve devreye alınmayı bekliyor.
 * onInstallFailed():     ilk kurulum başarısız oldu (ör. bir dosya indirilemedi).
 */
export async function registerServiceWorker({ onUpdateReady, onInstallFailed } = {}) {
  let registration;
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (error) {
    console.error('Service worker kaydedilemedi:', error);
    return null;
  }
  if (!registration) return null;

  // Sayfayı zaten bir sürüm yönetiyorsa ve yenisi bekliyorsa, bu bir güncellemedir.
  const reportWaitingWorker = () => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      onUpdateReady?.(registration.waiting);
    }
  };

  const trackInstallingWorker = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') reportWaitingWorker();
      if (worker.state === 'redundant' && !registration.active) onInstallFailed?.();
    });
  };

  reportWaitingWorker();
  trackInstallingWorker(registration.installing);
  registration.addEventListener('updatefound', () => {
    trackInstallingWorker(registration.installing);
  });

  setInterval(() => {
    if (navigator.onLine) registration.update().catch(() => {});
  }, UPDATE_CHECK_INTERVAL_MS);

  return registration;
}

/** Bekleyen yeni sürümü devreye alır; devraldığında sayfayı bir kez yeniler. */
export function activateUpdate(waitingWorker) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

/** Service worker'a sürüm numarasını sorar; yanıt gelmezse null döner. */
export function askWorkerVersion(worker, timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (!worker) {
      resolve(null);
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.version ?? null);
    };
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  });
}

/** İnternet bağlantısı değiştikçe onChange(true/false) çağrılır. */
export function watchConnection(onChange) {
  const report = () => onChange(navigator.onLine);
  window.addEventListener('online', report);
  window.addEventListener('offline', report);
  report();
}

/**
 * Ana ekrana ekleme (uygulama olarak yükleme).
 *
 * - Chrome, Edge ve Samsung Internet (Android ve Windows) yüklemeye izin verdiğini
 *   bildirir; o zaman tek dokunuşla tarayıcının kendi "Yükle" penceresi açılır.
 * - iPhone ve iPad'de Apple, sitelerin kendilerini ana ekrana eklemesine izin vermez;
 *   bu cihazlarda kullanıcı Paylaş menüsünü kullanmalıdır. Uygulama bunun adımlarını gösterir.
 * - Uygulama zaten ana ekrandan (kendi penceresinde) açıldıysa hiçbir şey gösterilmez.
 *
 * Sonuç: { state(), install(), onChange(fn) }
 *   state() → { installed, canPrompt, platform: 'ios' | 'android' | 'desktop', inAppBrowser }
 *   install() → 'accepted' | 'dismissed' | 'manual' (manual: adımları göstermek gerekir)
 */
export function createInstaller() {
  let deferredPrompt = null;
  let installedNow = false;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // tarayıcının kendi bilgi çubuğu yerine bizim düğmemiz kullanılır
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedNow = true;
    notify();
  });
  const standaloneQuery = window.matchMedia?.('(display-mode: standalone)');
  standaloneQuery?.addEventListener?.('change', notify);

  function state() {
    return {
      installed: installedNow || isStandalone(),
      canPrompt: deferredPrompt !== null,
      platform: detectPlatform(),
      inAppBrowser: isInAppBrowser(),
    };
  }

  async function install() {
    if (!deferredPrompt) return 'manual';
    const promptEvent = deferredPrompt;
    deferredPrompt = null; // aynı pencere yalnızca bir kez açılabilir
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch (error) {
      console.warn('Yükleme penceresi açılamadı:', error);
      return 'manual';
    } finally {
      notify();
    }
  }

  return {
    state,
    install,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Uygulama ana ekrandan / kendi penceresinde mi açıldı? */
export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    window.navigator.standalone === true // iPhone ve iPad
  );
}

function detectPlatform() {
  const agent = navigator.userAgent || '';
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1; // iPadOS
  if (/iPhone|iPad|iPod/i.test(agent) || touchMac) return 'ios';
  if (/Android/i.test(agent)) return 'android';
  return 'desktop';
}

/** Instagram, WhatsApp gibi uygulamaların içindeki tarayıcılar ana ekrana ekleyemez. */
function isInAppBrowser() {
  return /FBAN|FBAV|Instagram|Line\/|WhatsApp|Twitter|TikTok|musical_ly|Snapchat/i.test(navigator.userAgent || '');
}
