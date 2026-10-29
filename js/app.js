/**
 * Repertuvarım — uygulamanın başlangıç noktası.
 *
 * Sayfa açıldığında:
 *  1. internetsiz çalışmayı sağlayan service worker'ı başlatır,
 *  2. şarkıları ve kategorileri veri katmanından alır,
 *  3. ekranları hazırlar ve adres çubuğuna göre doğru ekranı gösterir.
 */
import {
  registerServiceWorker,
  activateUpdate,
  askWorkerVersion,
  watchConnection,
  setupInstallButton,
} from './pwa.js';
import { startRouter, navigate } from './router.js';
import * as repository from './data/repository.js';
import { createSongListView } from './views/song-list.js';
import { renderSongDetail } from './views/song-detail.js';
import { createStatusView, describeOffline } from './views/status.js';

const byId = (id) => document.getElementById(id);

const views = {
  list: byId('view-list'),
  song: byId('view-song'),
  new: byId('view-new'),
  status: byId('view-status'),
};
const topbar = {
  brand: byId('topbar-brand'),
  back: byId('topbar-back'),
  statusLink: byId('topbar-status'),
  statusDot: byId('status-dot'),
};
const addButton = byId('fab-add');

// --- Ekranlar arası geçiş --------------------------------------------------

let currentView = null;
let listScrollY = 0;
let openedFromList = false;

/** Bir ekranı gösterir, diğerlerini gizler. title: pencere başlığında görünecek ad. */
function showView(name, title) {
  const previous = currentView;
  if (previous === 'list') listScrollY = window.scrollY;
  if (name !== 'list') openedFromList = previous === 'list';

  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;

  const isList = name === 'list';
  topbar.brand.hidden = !isList;
  topbar.back.hidden = isList;
  addButton.hidden = !isList;
  document.body.classList.toggle('has-fab', isList);
  document.title = title ? `${title} – Repertuvarım` : 'Repertuvarım';

  // Listeye dönünce kalınan yere, diğer ekranlarda en üste.
  window.scrollTo(0, isList ? listScrollY : 0);
  currentView = name;

  // Ekran okuyucu kullananlar için yeni ekranın başlığına geç (ilk açılış hariç).
  if (previous) views[name].querySelector('[tabindex="-1"]')?.focus({ preventScroll: true });
}

// Geri düğmesi: listeden gelindiyse tarayıcı geçmişinde bir adım geri, değilse listeye.
topbar.back.addEventListener('click', () => {
  if (openedFromList) history.back();
  else navigate('/');
});

// --- Durum ve internetsiz çalışma -------------------------------------------

const status = { appError: false, offline: 'pending', online: navigator.onLine, version: null };
const statusView = createStatusView(views.status);

function updateStatus(changes) {
  Object.assign(status, changes);
  statusView.update(status);
  const offline = describeOffline(status.offline);
  topbar.statusDot.dataset.tone = status.appError ? 'danger' : offline.tone;
  topbar.statusLink.setAttribute('aria-label', `Durum: internetsiz kullanım ${offline.text.toLocaleLowerCase('tr-TR')}`);
}

function showUpdateToast(waitingWorker) {
  const toast = byId('update-toast');
  const button = byId('update-button');
  toast.hidden = false;
  button.onclick = () => {
    button.disabled = true;
    activateUpdate(waitingWorker);
  };
}

async function setUpOfflineSupport() {
  watchConnection((online) => updateStatus({ online }));
  setupInstallButton(byId('install-button'));

  if (!('serviceWorker' in navigator)) {
    updateStatus({ offline: 'unsupported' });
    return;
  }
  const registration = await registerServiceWorker({
    onUpdateReady: showUpdateToast,
    onInstallFailed: () => updateStatus({ offline: 'failed' }),
  });
  if (!registration) {
    updateStatus({ offline: 'failed' });
    return;
  }
  // "ready": service worker etkin, yani uygulamanın dosyaları cihaza kaydedildi.
  const { active } = await navigator.serviceWorker.ready;
  updateStatus({ offline: 'ready', version: await askWorkerVersion(active) });
}

// --- Başlangıç -------------------------------------------------------------

async function start() {
  const [songs, categories] = await Promise.all([repository.listSongs(), repository.listCategories()]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  createSongListView(views.list, { songs, categories, usesSampleData: repository.usesSampleData });

  startRouter(
    [
      { pattern: /^\/$/, show: () => showView('list') },
      {
        pattern: /^\/sarki\/(?<id>[^/]+)$/,
        show: async ({ id }) => {
          const song = await repository.getSong(id);
          renderSongDetail(views.song, song, categoryById);
          showView('song', song ? song.title : 'Şarkı bulunamadı');
        },
      },
      { pattern: /^\/yeni$/, show: () => showView('new', 'Yeni şarkı') },
      { pattern: /^\/durum$/, show: () => showView('status', 'Durum') },
    ],
    () => navigate('/', { replace: true })
  );
}

updateStatus({});
setUpOfflineSupport().catch((error) => {
  console.error('İnternetsiz çalışma başlatılamadı:', error);
  updateStatus({ offline: 'failed' });
});

start().catch((error) => {
  console.error('Uygulama başlatılamadı:', error);
  updateStatus({ appError: true });
  views.list.hidden = false;
  views.list.replaceChildren(
    Object.assign(document.createElement('p'), {
      className: 'page page--screen',
      textContent: 'Şarkılar yüklenemedi. Uygulamayı kapatıp yeniden açmayı deneyin.',
    })
  );
});
