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
import { createCategoriesView } from './views/categories.js';
import { createSetlistsView, createSetlistView, newSetlistDialog } from './views/setlists.js';
import { pickDialog } from './views/dialog.js';
import { createScoresView, createScoreView, createScoreEditor } from './views/scores.js';

const byId = (id) => document.getElementById(id);

const views = {
  list: byId('view-list'),
  song: byId('view-song'),
  editor: byId('view-editor'),
  status: byId('view-status'),
  import: byId('view-import'),
  categories: byId('view-categories'),
  setlists: byId('view-setlists'),
  setlist: byId('view-setlist'),
  scores: byId('view-scores'),
  score: byId('view-score'),
  scoreEditor: byId('view-score-editor'),
};
const tabs = {
  nav: byId('main-tabs'),
  songs: byId('tab-songs'),
  setlists: byId('tab-setlists'),
  scores: byId('tab-scores'),
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
let categoriesView = null;
let setlistsView = null;
let setlistView = null;
let scoresView = null;
let scoreView = null;
let scoreEditor = null;
let scoreEditorId = null;
let editorSongId = null; // düzenlenen şarkı (yeni şarkıda null)

// Ekranların paylaştığı güncel veriler (değişince repository.onChange ile yenilenir).
const data = { songs: [], categories: [], setlists: [], scores: [] };
const categoryById = new Map(); // şarkı ekranı bu nesneyi kullanır; yerinde güncellenir
let appFailed = false;

// --- Ekranlar arası geçiş --------------------------------------------------

let currentView = null;
let listScrollY = 0;

/** Bir ekranı gösterir, diğerlerini gizler. title: pencere başlığında görünecek ad. */
function showView(name, title, { backLabel = null } = {}) {
  const previous = currentView;
  if (previous === 'list') listScrollY = window.scrollY;
  // Formdan herhangi bir yolla çıkılınca bekleyen taslak hemen kaydedilir.
  if (previous === 'editor' && name !== 'editor') editor?.suspend().then(refreshDrafts);
  // Şarkı ekranından çıkınca ekran kilidi ve yerleşim izleme bırakılır.
  if (previous === 'song' && name !== 'song') songView?.hide();
  if (previous === 'score' && name !== 'score') scoreView?.hide();
  if (previous === 'scoreEditor' && name !== 'scoreEditor') scoreEditor?.close();

  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;

  const isList = name === 'list';
  const isHome = isList || name === 'setlists' || name === 'scores'; // ana bölümler: üstte sekmeler, geri yok
  topbar.brand.hidden = !isHome;
  topbar.back.hidden = isHome;
  topbar.backLabel.textContent = backLabel ?? (name === 'song' ? 'Şarkılar' : 'Geri');
  tabs.nav.hidden = !isHome;
  tabs.songs.toggleAttribute('aria-current', isList);
  tabs.setlists.toggleAttribute('aria-current', name === 'setlists');
  if (isList) tabs.songs.setAttribute('aria-current', 'page');
  if (name === 'setlists') tabs.setlists.setAttribute('aria-current', 'page');
  tabs.scores.toggleAttribute('aria-current', name === 'scores');
  if (name === 'scores') tabs.scores.setAttribute('aria-current', 'page');
  addButton.hidden = !isList || appFailed;
  document.body.classList.toggle('has-fab', isList && !appFailed);
  document.body.classList.toggle('has-bar', name === 'song' || name === 'score');
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
  if (currentView === 'scoreEditor' && scoreEditor && !(await scoreEditor.requestLeave())) return;
  if (canGoBack()) {
    history.back();
  } else {
    navigate(parentPath(), { replace: true });
  }
}

/** Geride uygulama ekranı yoksa (bağlantıdan açıldıysa) geri düğmesinin gideceği üst ekran. */
function parentPath() {
  if (currentView === 'editor' && editorSongId) return `/sarki/${encodeURIComponent(editorSongId)}`;
  if (currentView === 'setlist') return '/setlistler';
  if (currentView === 'score') return '/notalar';
  if (currentView === 'scoreEditor') return scoreEditorId ? `/nota/${encodeURIComponent(scoreEditorId)}` : '/notalar';
  if (currentView === 'song' && currentSetlistId) return `/setlist/${encodeURIComponent(currentSetlistId)}`;
  return '/';
}
let currentSetlistId = null; // şarkı bir setlistten açıldıysa

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

/** Şarkıları, kategorileri ve setlistleri veritabanından yeniden okur. */
async function loadData() {
  const [songs, categories, setlists, scores] = await Promise.all([
    repository.listSongs(),
    repository.listCategories(),
    repository.listSetlists(),
    repository.listScores(),
  ]);
  Object.assign(data, { songs, categories, setlists, scores });
  categoryById.clear();
  for (const category of categories) categoryById.set(category.id, category);
}

/** Setlisti bulur; az önce oluşturulduysa veriler henüz yenilenmemiş olabilir, yeniden okur. */
async function findSetlist(id) {
  let setlist = data.setlists.find((item) => item.id === id);
  if (!setlist) {
    await loadData().catch(() => {});
    setlist = data.setlists.find((item) => item.id === id);
  }
  return setlist ?? null;
}

function songMap() {
  return new Map(data.songs.map((song) => [song.id, song]));
}

/** Notanın seçilen tonu (şarkı başına) ve porte boyutu / nota adları (bütün notalar için). */
async function loadScorePrefs(id) {
  const [saved, scale, names] = await Promise.all([
    repository.getSetting(`scoreKey:${id}`, null),
    repository.getSetting('scoreScale', 1),
    repository.getSetting('scoreNames', true),
  ]).catch(() => [null, 1, true]);
  return { target: saved ? { step: saved.step, alter: saved.alter } : null, octave: saved?.octave ?? 0, scale, names };
}

function saveScorePref(name, value, id) {
  const key = name === 'target' ? `scoreKey:${id}` : name === 'scale' ? 'scoreScale' : 'scoreNames';
  repository.setSetting(key, value).catch((error) => console.error('Tercih kaydedilemedi:', error));
}

const NEW_SETLIST = '__yeni__';

/** Şarkı ekranındaki "Setliste ekle": hangi setlistlerde olacağını seçtirir. */
async function addToSetlist(song) {
  const create = (name, songIds) => repository.createSetlist(name, songIds);
  if (!data.setlists.length) {
    const created = await newSetlistDialog(create, [song.id]);
    if (created) showMessage(`“${song.title}”, “${created.name}” setlistine eklendi.`);
    return;
  }
  const picked = await pickDialog({
    title: `“${song.title}” hangi setlistlerde olsun?`,
    items: [
      ...data.setlists.map((setlist) => ({
        id: setlist.id,
        label: setlist.name,
        sublabel: `${setlist.songIds.length} şarkı`,
        checked: setlist.songIds.includes(song.id),
      })),
      { id: NEW_SETLIST, label: '+ Yeni setlist oluştur', sublabel: 'Ad sorulur, şarkı içine eklenir' },
    ],
    confirmLabel: 'Kaydet',
    searchable: data.setlists.length > 6,
  });
  if (!picked) return;
  const chosen = new Set(picked);
  let added = 0;
  let removed = 0;
  try {
    for (const setlist of data.setlists) {
      const has = setlist.songIds.includes(song.id);
      if (chosen.has(setlist.id) && !has) {
        await repository.updateSetlist(setlist.id, { songIds: [...setlist.songIds, song.id] });
        added += 1;
      } else if (!chosen.has(setlist.id) && has) {
        await repository.updateSetlist(setlist.id, { songIds: setlist.songIds.filter((id) => id !== song.id) });
        removed += 1;
      }
    }
  } catch (error) {
    console.error('Setlist kaydedilemedi:', error);
    showMessage(describeStorageError(error), { tone: 'error' });
    return;
  }
  if (chosen.has(NEW_SETLIST)) {
    const created = await newSetlistDialog(create, [song.id]);
    if (created) added += 1;
  }
  if (added || removed) {
    const parts = [added ? `${added} setliste eklendi` : '', removed ? `${removed} setlistten çıkarıldı` : ''].filter(Boolean);
    showMessage(`“${song.title}” ${parts.join(', ')}.`);
  }
}

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
    // Düzenlemede şarkı ekranına (setlistten açıldıysa setlistteki hâline) geri dönülür;
    // yeni şarkıda form, şarkı ekranıyla değiştirilir.
    const previous = previousPath() ?? '';
    const cameFromSong = previous === `/sarki/${song.id}` || (previous.startsWith('/setlist/') && previous.endsWith(`/${song.id}`));
    if (songId && canGoBack() && cameFromSong) history.back();
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
        pattern: /^\/favoriler$/,
        show: () => {
          listView?.setFilter('favorites');
          navigate('/', { replace: true });
        },
      },
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
          currentSetlistId = null;
          await songView.show(song);
          showView('song', song ? song.title : 'Şarkı bulunamadı');
        },
      },
      {
        pattern: /^\/notalar$/,
        show: () => {
          if (appFailed) return navigate('/', { replace: true });
          scoresView.show(data.scores);
          showView('scores', 'Notalar');
        },
      },
      {
        pattern: /^\/nota\/yeni$/,
        show: () => {
          if (appFailed) return navigate('/', { replace: true });
          scoreEditorId = null;
          scoreEditor.open(null);
          showView('scoreEditor', 'Yeni nota');
        },
      },
      {
        pattern: /^\/nota\/(?<id>[^/]+)$/,
        show: async ({ id }) => {
          if (appFailed) return navigate('/', { replace: true });
          const score = await repository.getScore(id).catch(() => null);
          await scoreView.show(score);
          showView('score', score ? score.title : 'Nota bulunamadı');
        },
      },
      {
        pattern: /^\/nota\/(?<id>[^/]+)\/duzenle$/,
        show: async ({ id }) => {
          if (appFailed) return navigate('/', { replace: true });
          const score = await repository.getScore(id).catch(() => null);
          if (!score) return navigate('/notalar', { replace: true });
          scoreEditorId = score.id;
          scoreEditor.open(score);
          showView('scoreEditor', `Düzenle: ${score.title}`);
        },
      },
      {
        pattern: /^\/kategoriler$/,
        show: () => {
          if (appFailed) return navigate('/', { replace: true });
          categoriesView.show(data.categories, data.songs);
          showView('categories', 'Kategoriler');
        },
      },
      {
        pattern: /^\/setlistler$/,
        show: () => {
          if (appFailed) return navigate('/', { replace: true });
          setlistsView.show(data.setlists, songMap());
          showView('setlists', 'Setlistler');
        },
      },
      {
        pattern: /^\/setlist\/(?<id>[^/]+)$/,
        show: async ({ id }) => {
          if (appFailed) return navigate('/', { replace: true });
          const setlist = await findSetlist(id);
          setlistView.show(setlist, data.songs);
          showView('setlist', setlist ? setlist.name : 'Setlist bulunamadı');
        },
      },
      {
        pattern: /^\/setlist\/(?<setlistId>[^/]+)\/(?<songId>[^/]+)$/,
        show: async ({ setlistId, songId }) => {
          if (appFailed) return navigate('/', { replace: true });
          const setlist = await findSetlist(setlistId);
          const songs = songMap();
          const order = setlist ? setlist.songIds.filter((id) => songs.has(id)) : [];
          const index = order.indexOf(songId);
          if (!setlist || index === -1) return navigate(setlist ? `/setlist/${encodeURIComponent(setlistId)}` : '/setlistler', { replace: true });
          currentSetlistId = setlist.id;
          const song = songs.get(songId);
          await songView.show(song, {
            setlist: {
              id: setlist.id,
              name: setlist.name,
              index,
              total: order.length,
              prev: index > 0 ? songs.get(order[index - 1]) : null,
              next: index < order.length - 1 ? songs.get(order[index + 1]) : null,
            },
          });
          showView('song', song.title, { backLabel: 'Setlist' });
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

  await loadData();

  listView = createSongListView(views.list, { songs: data.songs, categories: data.categories, onRemoveSamples: removeSamples });
  editor = createSongEditor(views.editor, { categories: () => data.categories, actions: editorActions });
  songView = createSongView(views.song, {
    categoryById,
    onToggleFavorite: toggleFavorite,
    loadPrefs: loadSongPrefs,
    savePref: saveSongPref,
    onAddToSetlist: addToSetlist,
  });
  categoriesView = createCategoriesView(views.categories, {
    createCategory: (fields) => repository.createCategory(fields),
    updateCategory: (id, fields) => repository.updateCategory(id, fields),
    reorderCategories: (ids) => repository.reorderCategories(ids),
    deleteCategory: (id) => repository.deleteCategory(id),
  });
  setlistsView = createSetlistsView(views.setlists, { createSetlist: (name, songIds) => repository.createSetlist(name, songIds) });
  setlistView = createSetlistView(views.setlist, {
    updateSetlist: (id, changes) => repository.updateSetlist(id, changes),
    deleteSetlist: (id) => repository.deleteSetlist(id),
    onDeleted: () => (canGoBack() && previousPath() === '/setlistler' ? history.back() : navigate('/setlistler', { replace: true })),
  });

  scoresView = createScoresView(views.scores);
  scoreView = createScoreView(views.score, { loadPrefs: loadScorePrefs, savePref: saveScorePref });
  scoreEditor = createScoreEditor(views.scoreEditor, {
    leave: goBack,
    async save(fields, id) {
      let score;
      try {
        score = id ? await repository.updateScore(id, fields) : await repository.createScore(fields);
      } catch (error) {
        return reportAndRethrow('Nota kaydedilemedi:', error);
      }
      showMessage(id ? 'Değişiklikler kaydedildi.' : 'Nota kaydedildi.');
      const path = `/nota/${encodeURIComponent(score.id)}`;
      if (id && canGoBack() && previousPath() === `/nota/${score.id}`) history.back();
      else navigate(path, { replace: true });
      return score;
    },
    async remove(id) {
      try {
        await repository.deleteScore(id);
      } catch (error) {
        reportAndRethrow('Nota silinemedi:', error);
      }
      showMessage('Nota silindi.');
      navigate('/notalar', { replace: true });
    },
  });

  // Kayıtlı veriler değişince (ekleme, düzenleme, silme, favori, kategori, setlist)
  // açık ekranlar ve durum yenilenir.
  repository.onChange(async () => {
    try {
      await loadData();
      listView.setSongs(data.songs);
      listView.setCategories(data.categories);
      if (currentView === 'categories') categoriesView.update(data.categories, data.songs);
      if (currentView === 'setlists') setlistsView.update(data.setlists, songMap());
      if (currentView === 'scores') scoresView.update(data.scores);
      if (currentView === 'setlist') setlistView.update(data.setlists.find((item) => item.id === setlistView.id) ?? null, data.songs);
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
