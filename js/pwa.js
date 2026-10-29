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
 * Tarayıcı uygulamanın yüklenebileceğini bildirirse düğmeyi gösterir.
 * (Chrome ve Edge bu bildirimi yapar; iPhone'da yükleme Paylaş menüsünden yapılır.)
 */
export function setupInstallButton(button) {
  let installPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    button.hidden = false;
  });

  button.addEventListener('click', async () => {
    if (!installPrompt) return;
    button.disabled = true;
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
    } catch (error) {
      console.warn('Yükleme penceresi açılamadı:', error);
    } finally {
      installPrompt = null;
      button.hidden = true;
      button.disabled = false;
    }
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    button.hidden = true;
  });
}
