/**
 * Repertuvarım — uygulamanın başlangıç noktası.
 *
 * Sayfa açıldığında:
 *  1. "Durum" bölümünü günceller,
 *  2. internetsiz çalışmayı sağlayan service worker'ı başlatır,
 *  3. yeni bir sürüm yayınlandıysa "Güncelle" bildirimini gösterir.
 */
import {
  registerServiceWorker,
  activateUpdate,
  askWorkerVersion,
  watchConnection,
  setupInstallButton,
} from './pwa.js';

const elements = {
  appState: document.getElementById('state-app'),
  offlineState: document.getElementById('state-offline'),
  networkState: document.getElementById('state-network'),
  version: document.getElementById('state-version'),
  installButton: document.getElementById('install-button'),
  updateToast: document.getElementById('update-toast'),
  updateButton: document.getElementById('update-button'),
};

/** Bir durum satırının yazısını ve rengini değiştirir. tone: 'ok' | 'neutral' | 'danger' */
function setState(element, text, tone = 'neutral') {
  element.textContent = text;
  element.dataset.tone = tone;
}

/** Yeni sürüm hazır olduğunda alttaki bildirimi gösterir. */
function showUpdateToast(waitingWorker) {
  elements.updateToast.hidden = false;
  elements.updateButton.onclick = () => {
    elements.updateButton.disabled = true;
    activateUpdate(waitingWorker);
  };
}

async function start() {
  setState(elements.appState, 'Çalışıyor', 'ok');

  watchConnection((online) => {
    setState(elements.networkState, online ? 'Var' : 'Yok', online ? 'ok' : 'neutral');
  });

  setupInstallButton(elements.installButton);

  if (!('serviceWorker' in navigator)) {
    setState(elements.offlineState, 'Bu tarayıcıda desteklenmiyor', 'danger');
    return;
  }

  const registration = await registerServiceWorker({
    onUpdateReady: showUpdateToast,
    onInstallFailed: () => setState(elements.offlineState, 'Hazırlanamadı', 'danger'),
  });

  if (!registration) {
    setState(elements.offlineState, 'Hazırlanamadı', 'danger');
    return;
  }

  // "ready": service worker etkin, yani uygulamanın dosyaları cihaza kaydedildi.
  const { active } = await navigator.serviceWorker.ready;
  setState(elements.offlineState, 'Hazır', 'ok');
  elements.version.textContent = (await askWorkerVersion(active)) ?? '—';
}

start().catch((error) => {
  console.error('Uygulama başlatılamadı:', error);
  setState(elements.appState, 'Hata oluştu', 'danger');
});
