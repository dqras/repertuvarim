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
  createInstaller,
} from './pwa.js';
import { startRouter, navigate, canGoBack, previousPath } from './router.js';
import * as repository from './data/repository.js';
import { describeStorageError, estimateStorage, requestPersistence } from './data/db.js';
import { el } from './lib/dom.js';
import { createSongListView } from './views/song-list.js';
import { createSongView } from './views/song-detail.js';
import { renderImportHelp } from './views/import-help.js';
import { createSongEditor } from './views/song-editor.js';
import { createStatusView, describeOffline } from './views/status.js';
import { confirmDialog } from './views/dialog.js';
import { showMessage } from './views/components.js';
import { setupInstallUi } from './views/install.js';

const byId = (id) => document.getElementById(id);

const views = {
  list: byId('view-list'),
  song: byId('view-song'),
  editor: byId('view-editor'),
  status: byId('view-status'),
  import: byId('view-import'),
};
const topbar = {
  brand: byId('topbar-brand'),
  back: byId('topbar-back'),
  backLabel: byId('topbar-back-label'),
  statusLink: byId('topbar-status'),
  statusDot: byId('status-dot'),
};
const addButton = byId('fab-add');

let listView = null;
let editor = null;
let songView = null;
let editorSongId = null; // düzenlenen şarkı (yeni şarkıda null)
let appFailed = false;

// --- Ekranlar arası geçiş --------------------------------------------------

let currentView = null;
let listScrollY = 0;

/** Bir ekranı gösterir, diğerlerini gizler. title: pencere başlığında görünecek ad. */
function showView(name, title) {
  const previous = currentView;
  if (previous === 'list') listScrollY = window.scrollY;
  // Formdan herhangi bir yolla çıkılınca bekleyen taslak hemen kaydedilir.
  if (previous === 'editor' && name !== 'editor') editor?.suspend().then(refreshDrafts);
  // Şarkı ekranından çıkınca ekran kilidi ve yerleşim izleme bırakılır.
  if (previous === 'song' && name !== 'song') songView?.hide();

  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;

  const isList = name === 'list';
  topbar.brand.hidden = !isList;
  topbar.back.hidden = isList;
  topbar.backLabel.textContent = name === 'song' ? 'Şarkılar' : 'Geri';
  addButton.hidden = !isList || appFailed;
  document.body.classList.toggle('has-fab', isList && !appFailed);
  document.body.classList.toggle('has-bar', name === 'song');
  document.title = title ? `${title} – Repertuvarım` : 'Repertuvarım';

  // Listeye dönünce kalınan yere, diğer ekranlarda en üste.
  window.scrollTo(0, isList ? listScrollY : 0);
  currentView = name;

  // Ekran okuyucu kullananlar için yeni ekranın başlığına geç (ilk açılış hariç).
  if (previous) views[name].querySelector('[tabindex="-1"]')?.focus({ preventScroll: true });
}

/** Geri: formda değişiklik varsa önce sorar; geride uygulama ekranı yoksa bir üst ekrana gider. */
async function goBack() {
  if (currentView === 'editor' && editor && !(await editor.requestLeave())) return;
  if (canGoBack()) {
    history.back();
  } else {
    const parent = currentView === 'editor' && editorSongId ? `/sarki/${encodeURIComponent(editorSongId)}` : '/';
    navigate(parent, { replace: true });
  }
}

topbar.back.addEventListener('click', goBack);

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

/** Hata mesajını gösterir ve hatayı çağırana geri fırlatır. */
function reportAndRethrow(label, error) {
  console.error(label, error);
  showMessage(describeStorageError(error), { tone: 'error' });
  throw error;
}

/** Favori düğmesi: kaydeder ve güncel şarkıyı döndürür; hata olursa mesaj gösterir. */
async function toggleFavorite(song) {
  try {
    return await repository.setFavorite(song.id, !song.favorite);
  } catch (error) {
    return reportAndRethrow('Favori kaydedilemedi:', error);
  }
}

async function removeSamples() {
  const confirmed = await confirmDialog({
    title: 'Örnek şarkılar kaldırılsın mı?',
    message:
      'Listedeki örnek şarkıların hepsi silinir. Kendi eklediğiniz ya da düzenlediğiniz şarkılar etkilenmez. Bu işlem geri alınamaz.',
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

/** Formun kullandığı işlemler: taslaklar, kaydetme, silme, geri. */
const editorActions = {
  loadDraft: (key) => repository.getDraft(key),
  saveDraft: (key, form) => repository.saveDraft(key, form),
  deleteDraft: (key) => repository.deleteDraft(key),
  leave: goBack,

  async save(value, songId) {
    let song;
    try {
      song = songId ? await repository.updateSong(songId, value) : await repository.createSong(value);
    } catch (error) {
      return reportAndRethrow('Şarkı kaydedilemedi:', error);
    }
    showMessage(songId ? 'Değişiklikler kaydedildi.' : 'Şarkı kaydedildi.');
    const songPath = `/sarki/${encodeURIComponent(song.id)}`;
    // Düzenlemede şarkı ekranına geri dönülür; yeni şarkıda form, şarkı ekranıyla değiştirilir.
    if (songId && canGoBack() && previousPath() === songPath) history.back();
    else navigate(songPath, { replace: true });
    return song;
  },

  async remove(songId) {
    try {
      await repository.deleteSong(songId);
    } catch (error) {
      reportAndRethrow('Şarkı silinemedi:', error);
    }
    showMessage('Şarkı silindi.');
    navigate('/', { replace: true });
  },
};

/** Kaydedilmemiş taslakları listenin üstünde gösterir. */
async function refreshDrafts() {
  if (!listView) return;
  try {
    const items = [];
    for (const draft of await repository.listDrafts()) {
      const typedTitle = String(draft.form?.title ?? '').trim();
      if (draft.key === 'new') {
        items.push({ title: typedTitle || 'Adsız yeni şarkı', href: '#/yeni' });
        continue;
      }
      const song = await repository.getSong(draft.key);
      if (!song) {
        repository.deleteDraft(draft.key).catch(() => {}); // şarkısı silinmiş taslak
        continue;
      }
      items.push({ title: typedTitle || song.title, href: `#/sarki/${encodeURIComponent(song.id)}/duzenle` });
    }
    listView.setDrafts(items);
  } catch (error) {
    console.error('Taslaklar okunamadı:', error);
  }
}

// --- Şarkı ekranı ayarları ------------------------------------------------------

/** Şarkı ekranının hatırlanan ayarları: bu şarkının transpozesi, yazı boyutu, ekran açık. */
async function loadSongPrefs(songId) {
  try {
    const [steps, scale, keepAwake] = await Promise.all([
      repository.getSetting(`transpose:${songId}`, 0),
      repository.getSetting('fontScale', 1),
      repository.getSetting('keepAwake', false),
    ]);
    return { steps, scale, keepAwake };
  } catch (error) {
    console.error('Ayarlar okunamadı:', error);
    return { steps: 0, scale: 1, keepAwake: false };
  }
}

function saveSongPref(name, value, songId) {
  const key = { steps: `transpose:${songId}`, scale: 'fontScale', keepAwake: 'keepAwake' }[name];
  const stored = name === 'steps' && value === 0 ? null : value; // orijinal tonda kayıt tutulmaz
  repository.setSetting(key, stored).catch((error) => console.error('Ayar kaydedilemedi:', error));
}

// --- Başlangıç -------------------------------------------------------------

function startAppRouter(categoryById) {
  startRouter(
    [
      { pattern: /^\/$/, show: () => showView('list') },
      {
        pattern: /^\/sarki\/(?<id>[^/]+)$/,
        show: async ({ id }) => {
          if (appFailed) return navigate('/', { replace: true });
          let song = null;
          try {
            song = await repository.getSong(id);
          } catch (error) {
            console.error('Şarkı okunamadı:', error);
            showMessage(describeStorageError(error), { tone: 'error' });
          }
          await songView.show(song);
          showView('song', song ? song.title : 'Şarkı bulunamadı');
        },
      },
      {
        pattern: /^\/sarki\/(?<id>[^/]+)\/duzenle$/,
        show: async ({ id }) => {
          if (appFailed) return navigate('/', { replace: true });
          let song = null;
          try {
            song = await repository.getSong(id);
          } catch (error) {
            console.error('Şarkı okunamadı:', error);
          }
          if (!song) {
            await songView.show(null);
            showView('song', 'Şarkı bulunamadı');
            return;
          }
          editorSongId = song.id;
          await editor.open({ song });
          showView('editor', `Düzenle: ${song.title}`);
        },
      },
      {
        pattern: /^\/yeni$/,
        show: async () => {
          if (appFailed) return navigate('/', { replace: true });
          editorSongId = null;
          await editor.open();
          showView('editor', 'Yeni şarkı');
        },
      },
      {
        pattern: /^\/aktar$/,
        show: () => {
          renderImportHelp(views.import);
          showView('import', 'Sitelerden aktarma');
        },
      },
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

  listView = createSongListView(views.list, { songs, categories, onRemoveSamples: removeSamples });
  editor = createSongEditor(views.editor, { categories, actions: editorActions });
  songView = createSongView(views.song, {
    categoryById,
    onToggleFavorite: toggleFavorite,
    loadPrefs: loadSongPrefs,
    savePref: saveSongPref,
  });

  // Kayıtlı veriler değişince (ekleme, düzenleme, silme, favori) liste ve durum yenilenir.
  repository.onChange(async () => {
    try {
      listView.setSongs(await repository.listSongs());
    } catch (error) {
      console.error('Liste yenilenemedi:', error);
      showMessage(describeStorageError(error), { tone: 'error' });
    }
    refreshDrafts();
    refreshStorageStatus();
  });

  startAppRouter(categoryById);
  refreshDrafts();

  // Verilerin kendiliğinden silinmemesi için izin iste (tarayıcı genellikle sessizce karar verir).
  updateStatus({ persistence: await requestPersistence() });
  refreshStorageStatus();
}

// Uygulama arka plana alınırken (telefonda başka uygulamaya geçince) bekleyen taslak kaydedilir.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && currentView === 'editor') editor?.flush();
});

// "Ana ekrana ekle": listede bir kart ve Durum ekranında bir düğme.
// Yükleme penceresine izin veren olay sayfa açılır açılmaz gelebileceği için en başta kurulur.
setupInstallUi({
  installer: createInstaller(),
  card: byId('install-card'),
  statusButton: byId('install-button'),
  onInstalled: () => showMessage('Uygulama yüklendi. Artık ana ekranınızdan açabilirsiniz.'),
});

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
