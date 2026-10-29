/**
 * Repertuvarım — uygulamanın başlangıç noktası.
 *
 * Sayfa açıldığında:
 *  1. internetsiz çalışmayı sağlayan service worker'ı başlatır,
 *  2. cihazdaki veritabanını açar, şarkıları ve kategorileri okur,
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
import { describeStorageError, estimateStorage, requestPersistence } from './data/db.js';
import { el } from './lib/dom.js';
import { createSongListView } from './views/song-list.js';
import { renderSongDetail } from './views/song-detail.js';
import { createStatusView, describeOffline } from './views/status.js';
import { confirmDialog } from './views/dialog.js';
import { showMessage } from './views/components.js';

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
let appFailed = false;

/** Bir ekranı gösterir, diğerlerini gizler. title: pencere başlığında görünecek ad. */
function showView(name, title) {
  const previous = currentView;
  if (previous === 'list') listScrollY = window.scrollY;
  if (name !== 'list') openedFromList = previous === 'list';

  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;

  const isList = name === 'list';
  topbar.brand.hidden = !isList;
  topbar.back.hidden = isList;
  addButton.hidden = !isList || appFailed;
  document.body.classList.toggle('has-fab', isList && !appFailed);
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

const status = {
  appError: false,
  offline: 'pending',
  online: navigator.onLine,
  version: null,
  songCount: null,
  persistence: 'pending',
  storage: null,
};
const statusView = createStatusView(views.status);

function updateStatus(changes) {
  Object.assign(status, changes);
  statusView.update(status);
  const offline = describeOffline(status.offline);
  topbar.statusDot.dataset.tone = status.appError ? 'danger' : offline.tone;
  topbar.statusLink.setAttribute(
    'aria-label',
    `Durum: internetsiz kullanım ${offline.text.toLocaleLowerCase('tr-TR')}`
  );
}

/** Kayıtlı şarkı sayısını ve kullanılan alanı yeniler. */
async function refreshStorageStatus() {
  const [songCount, storage] = await Promise.all([
    repository.countSongs().catch(() => null),
    estimateStorage(),
  ]);
  updateStatus({ songCount, storage });
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

// --- Kullanıcı işlemleri ---------------------------------------------------

/** Favori düğmesi: kaydeder ve güncel şarkıyı döndürür; hata olursa mesaj gösterir. */
async function toggleFavorite(song) {
  try {
    return await repository.setFavorite(song.id, !song.favorite);
  } catch (error) {
    console.error('Favori kaydedilemedi:', error);
    showMessage(describeStorageError(error), { tone: 'error' });
    throw error;
  }
}

async function removeSamples() {
  const confirmed = await confirmDialog({
    title: 'Örnek şarkılar kaldırılsın mı?',
    message:
      'Listedeki örnek şarkıların hepsi silinir. Kendi eklediğiniz şarkılar etkilenmez. Bu işlem geri alınamaz.',
    confirmLabel: 'Örnekleri kaldır',
    danger: true,
  });
  if (!confirmed) return;
  try {
    const removed = await repository.removeSampleSongs();
    showMessage(`${removed} örnek şarkı kaldırıldı.`);
  } catch (error) {
    console.error('Örnek şarkılar kaldırılamadı:', error);
    showMessage(describeStorageError(error), { tone: 'error' });
  }
}

// --- Başlangıç -------------------------------------------------------------

function startAppRouter(categoryById) {
  startRouter(
    [
      { pattern: /^\/$/, show: () => showView('list') },
      {
        pattern: /^\/sarki\/(?<id>[^/]+)$/,
        show: async ({ id }) => {
          if (appFailed) {
            navigate('/', { replace: true });
            return;
          }
          let song = null;
          try {
            song = await repository.getSong(id);
          } catch (error) {
            console.error('Şarkı okunamadı:', error);
            showMessage(describeStorageError(error), { tone: 'error' });
          }
          renderSongDetail(views.song, song, categoryById, { onToggleFavorite: toggleFavorite });
          showView('song', song ? song.title : 'Şarkı bulunamadı');
        },
      },
      { pattern: /^\/yeni$/, show: () => showView('new', 'Yeni şarkı') },
      {
        pattern: /^\/durum$/,
        show: () => {
          showView('status', 'Durum');
          refreshStorageStatus();
        },
      },
    ],
    () => navigate('/', { replace: true })
  );
}

function showStartupError(error) {
  appFailed = true;
  updateStatus({ appError: true });
  views.list.replaceChildren(
    el(
      'div',
      { class: 'page page--screen' },
      el('h1', { class: 'screen-title', tabindex: '-1', text: 'Şarkılar açılamadı' }),
      el('p', { class: 'startup-error__text', text: describeStorageError(error) }),
      el('p', { class: 'startup-error__detail', text: `Teknik ayrıntı: ${error?.cause?.name ?? error?.name ?? 'bilinmiyor'}` })
    )
  );
}

async function start() {
  await repository.init({
    onBlocked: () =>
      showMessage('Uygulamanın eski sürümü başka bir pencerede açık. Diğer pencereleri kapatın.', {
        tone: 'error',
        duration: 10000,
      }),
    onVersionChange: () =>
      showMessage('Uygulama başka bir pencerede güncellendi. Bu pencereyi kapatıp yeniden açın.', {
        tone: 'error',
        duration: 15000,
      }),
  });

  const [songs, categories] = await Promise.all([repository.listSongs(), repository.listCategories()]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const listView = createSongListView(views.list, { songs, categories, onRemoveSamples: removeSamples });

  // Kayıtlı veriler değişince (favori, silme) liste ve durum yenilenir.
  repository.onChange(async () => {
    try {
      listView.setSongs(await repository.listSongs());
    } catch (error) {
      console.error('Liste yenilenemedi:', error);
      showMessage(describeStorageError(error), { tone: 'error' });
    }
    refreshStorageStatus();
  });

  startAppRouter(categoryById);

  // Verilerin kendiliğinden silinmemesi için izin iste (tarayıcı genellikle sessizce karar verir).
  updateStatus({ persistence: await requestPersistence() });
  refreshStorageStatus();
}

updateStatus({});
setUpOfflineSupport().catch((error) => {
  console.error('İnternetsiz çalışma başlatılamadı:', error);
  updateStatus({ offline: 'failed' });
});

start().catch((error) => {
  console.error('Uygulama başlatılamadı:', error);
  showStartupError(error);
  startAppRouter(new Map());
});
