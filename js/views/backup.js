/**
 * Yedekleme ekranı (#/yedek):
 *  - Yedek al: bütün repertuvarı tek bir dosyaya indirir (internet gerekmez).
 *  - Şarkıları dosyaya aktar: seçilen şarkıları ayrı bir dosyaya kaydeder.
 *  - Yedekten geri yükle: dosyayı okur, önce ne olacağını gösterir; onaylanınca ekler.
 *    Mevcut kayıtlar silinmez; aynı olanlar atlanır, farklı olanlar için kullanıcı seçer.
 *  - Verilerin nerede saklandığını ve hangi durumlarda kaybolabileceğini anlatır.
 * Dosya biçimi ve karşılaştırma: data/backup.js
 */
import { el, icon } from '../lib/dom.js';
import { describeStorageError } from '../data/db.js';
import { BackupError, MAX_BACKUP_BYTES, backupFileName, buildBackup, parseBackup, planRestore, resolvePlan, summarizePlan } from '../data/backup.js';
import { confirmDialog, pickDialog } from './dialog.js';
import { showMessage } from './components.js';

export const REMIND_AFTER_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

/** "bugün", "dün", "5 gün önce", "hiç alınmadı" */
export function describeLastBackup(time, now = Date.now()) {
  if (!time) return 'Hiç alınmadı';
  const days = Math.floor((startOfDay(now) - startOfDay(time)) / DAY);
  const date = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(time);
  if (days <= 0) return `Bugün (${date})`;
  if (days === 1) return `Dün (${date})`;
  return `${days} gün önce (${date})`;
}
function startOfDay(time) {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Hatırlatma gösterilmeli mi? Kendi şarkısı olan ve 14 günden uzun süredir yedek almayan kullanıcıya. */
export function shouldRemind({ lastBackupAt, snoozeUntil, ownSongs, firstUseAt }, now = Date.now()) {
  if (ownSongs < 1) return false;
  if (snoozeUntil && now < snoozeUntil) return false;
  const since = lastBackupAt ?? firstUseAt ?? now;
  return now - since >= REMIND_AFTER_DAYS * DAY;
}

/** Dosyayı cihaza indirir (iPhone'da "Dosyalar"a, bilgisayarda İndirilenler klasörüne). */
function downloadFile(text, name) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * root: #view-backup. actions:
 *   exportRecords() → { songs, categories, setlists, scores }
 *   importRecords(records)
 *   getSetting(key), setSetting(key, value)
 *   appVersion() → '0.12.0'
 *   storageInfo() → { persistence, storage }
 */
export function createBackupView(root, actions) {
  let lastBackupAt = null;
  let restore = null; // { name, backup, plan, current, choice }

  async function show() {
    lastBackupAt = await actions.getSetting('lastBackupAt', null).catch(() => null);
    restore = null;
    render();
  }

  async function exportAll() {
    try {
      const records = await actions.exportRecords();
      const now = Date.now();
      const backup = await buildBackup(records, { appVersion: actions.appVersion(), now });
      downloadFile(JSON.stringify(backup), backupFileName({ now }));
      lastBackupAt = now;
      await actions.setSetting('lastBackupAt', now).catch(() => {});
      await actions.setSetting('backupSnoozeUntil', null).catch(() => {});
      const c = backup.counts;
      showMessage(`Yedek indirildi: ${c.songs} şarkı, ${c.setlists} setlist, ${c.scores} nota. Dosyayı güvenli bir yere (iCloud Drive, Google Drive, e-posta) kopyalayın.`, { duration: 7000 });
      render();
    } catch (error) {
      console.error('Yedek alınamadı:', error);
      showMessage(error instanceof BackupError ? error.message : `Yedek alınamadı. ${describeStorageError(error)}`, { tone: 'error' });
    }
  }

  async function exportSongs() {
    let records;
    try {
      records = await actions.exportRecords();
    } catch (error) {
      showMessage(describeStorageError(error), { tone: 'error' });
      return;
    }
    if (!records.songs.length) {
      showMessage('Henüz şarkı yok.');
      return;
    }
    const sorted = [...records.songs].sort((a, b) => a.title.localeCompare(b.title, 'tr'));
    const picked = await pickDialog({
      title: 'Hangi şarkılar dosyaya aktarılsın?',
      items: sorted.map((song) => ({ id: song.id, label: song.title, sublabel: song.artist || '' })),
      confirmLabel: 'Dosyaya aktar',
      searchable: sorted.length > 6,
    });
    if (!picked?.length) return;
    const chosen = new Set(picked);
    const songs = sorted.filter((song) => chosen.has(song.id));
    const now = Date.now();
    const backup = await buildBackup({ ...records, songs }, { kind: 'songs', appVersion: actions.appVersion(), now });
    downloadFile(JSON.stringify(backup), backupFileName({ kind: 'songs', now, title: songs.length === 1 ? songs[0].title : '' }));
    showMessage(`${songs.length} şarkı dosyaya aktarıldı. Bu dosyayı başka bir cihazda “Yedekten geri yükle” ile açabilirsiniz.`, { duration: 6000 });
  }

  async function openFile(file) {
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      showRestoreError('Bu dosya çok büyük; bir Repertuvarım yedeği olamaz.');
      return;
    }
    let backup;
    let current;
    try {
      backup = parseBackup(await file.text());
      current = await actions.exportRecords();
    } catch (error) {
      showRestoreError(error instanceof BackupError ? error.message : `Dosya okunamadı. ${describeStorageError(error)}`);
      return;
    }
    restore = { name: file.name, backup, current, plan: planRestore(backup, current), choice: 'keep' };
    render();
    root.querySelector('#backup-restore')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function showRestoreError(text) {
    restore = { error: text };
    render();
  }

  async function applyRestore() {
    const { plan, current, choice } = restore;
    const sum = summarizePlan(plan);
    const changed = sum.songs.changed + sum.setlists.changed + sum.scores.changed;
    if (choice === 'replace' && changed) {
      const ok = await confirmDialog({
        title: 'Sizdeki hâlleri değiştirilsin mi?',
        message: `${changed} kaydın bu cihazdaki hâli, yedekteki hâliyle değiştirilecek. Diğer kayıtlarınız olduğu gibi kalır.`,
        confirmLabel: 'Değiştir ve geri yükle',
        danger: true,
      });
      if (!ok) return;
    }
    const out = resolvePlan(plan, current, choice);
    const button = root.querySelector('#backup-apply');
    if (button) button.disabled = true;
    try {
      if (out.songs.length || out.categories.length || out.setlists.length || out.scores.length) await actions.importRecords(out);
    } catch (error) {
      console.error('Geri yüklenemedi:', error);
      showMessage(`Geri yüklenemedi; hiçbir şey değişmedi. ${describeStorageError(error)}`, { tone: 'error', duration: 8000 });
      if (button) button.disabled = false;
      return;
    }
    const { added, updated, skipped } = out.counts;
    const parts = [];
    if (added) parts.push(`${added} kayıt eklendi`);
    if (updated) parts.push(`${updated} kayıt güncellendi`);
    if (skipped) parts.push(`${skipped} kayıt zaten vardı`);
    restore = { done: parts.length ? `${parts.join(', ')}.` : 'Değişiklik yok.' };
    render();
    showMessage(`Geri yükleme tamamlandı: ${restore.done}`);
  }

  // --- Ekran ------------------------------------------------------------------------

  function restorePanel() {
    if (!restore) return null;
    if (restore.error) {
      return el('div', { class: 'notice notice--sheet backup-result', id: 'backup-restore', role: 'alert' },
        el('p', { class: 'notice__text', id: 'backup-error', text: restore.error }));
    }
    if (restore.done) {
      return el('div', { class: 'notice notice--import backup-result', id: 'backup-restore' },
        el('p', { class: 'notice__text', id: 'backup-done', text: `Geri yükleme tamamlandı: ${restore.done}` }),
        el('div', { class: 'notice__actions' }, el('a', { class: 'button button--primary button--small', href: '#/' }, 'Şarkılara git')));
    }
    const { backup, plan } = restore;
    const sum = summarizePlan(plan);
    const date = backup.exportedAt ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(backup.exportedAt)) : '';
    const row = (label, part) => el('tr', {},
      el('th', { scope: 'row', text: label }),
      el('td', { text: String(part.added) }),
      el('td', { text: String(part.same) }),
      el('td', { text: String(part.changed) }));
    const changed = sum.songs.changed + sum.setlists.changed + sum.scores.changed;
    const total = (k) => sum.songs[k] + sum.categories[k] + sum.setlists[k] + sum.scores[k];
    const option = (value, title, text) => el('label', { class: 'backup-choice' },
      el('input', { type: 'radio', name: 'backup-choice', value, checked: restore.choice === value, onchange: () => { restore.choice = value; } }),
      el('span', {}, el('strong', { text: title }), el('span', { class: 'backup-choice__text', text })));
    return el('section', { class: 'backup-restore', id: 'backup-restore', 'aria-labelledby': 'backup-restore-title' },
      el('h2', { class: 'section-title', id: 'backup-restore-title', text: 'Geri yüklemeden önce' }),
      el('p', { class: 'muted', id: 'backup-file', text: `${restore.name}${date ? ` · ${date}` : ''}${backup.kind === 'songs' ? ' · şarkı dosyası' : ''}` }),
      backup.skipped ? el('p', { class: 'field__error', text: `${backup.skipped} kayıt bozuk olduğu için atlanacak.` }) : null,
      el('table', { class: 'backup-table', id: 'backup-summary' },
        el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', { scope: 'col', text: 'Yeni' }), el('th', { scope: 'col', text: 'Zaten var' }), el('th', { scope: 'col', text: 'Farklı' }))),
        el('tbody', {},
          row('Şarkı', sum.songs),
          row('Kategori', sum.categories),
          row('Setlist', sum.setlists),
          row('Nota', sum.scores))),
      el('p', { class: 'backup-safe' }, icon('shield'), el('span', { text: 'Bu cihazdaki şarkılarınız silinmez. Yalnızca yeni olanlar eklenir; aynısı zaten olanlar atlanır.' })),
      changed
        ? el('fieldset', { class: 'backup-choices', id: 'backup-choices' },
            el('legend', { text: `${changed} kayıt hem bu cihazda hem yedekte var ama farklı. Ne yapılsın?` }),
            option('keep', 'Bendekini koru', 'Yedekteki farklı hâli eklenmez.'),
            option('replace', 'Yedektekini kullan', 'Bu cihazdaki hâli, yedekteki hâliyle değiştirilir.'),
            option('both', 'İkisini de tut', 'Yedekteki hâli “(yedekten)” adıyla ayrıca eklenir.'))
        : null,
      el('div', { class: 'backup-actions' },
        el('button', { type: 'button', class: 'button button--quiet', id: 'backup-cancel', onclick: () => { restore = null; render(); } }, 'Vazgeç'),
        el('button', { type: 'button', class: 'button button--primary', id: 'backup-apply', onclick: applyRestore },
          total('added') || changed ? 'Geri yükle' : 'Tamam (eklenecek bir şey yok)')));
  }

  function render() {
    const input = el('input', { type: 'file', accept: '.json,application/json', id: 'backup-file-input', hidden: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      openFile(file);
    });
    const old = lastBackupAt && Date.now() - lastBackupAt >= REMIND_AFTER_DAYS * DAY;
    root.replaceChildren(
      el('div', { class: 'page page--screen backup' },
        el('h1', { class: 'screen-title', tabindex: '-1', text: 'Yedekleme' }),
        el('p', { class: 'muted manage-lead', text: 'Şarkılarınız yalnızca bu cihazda saklanır. Kaybolmasın diye ara sıra yedek alın ve dosyayı başka bir yere kopyalayın. İnternet gerekmez.' }),

        el('div', { class: 'backup-card' },
          el('p', { class: 'backup-last' }, 'Son yedek: ', el('strong', { id: 'backup-last', class: old || !lastBackupAt ? 'is-old' : '', text: describeLastBackup(lastBackupAt) })),
          el('div', { class: 'backup-actions' },
            el('button', { type: 'button', class: 'button button--primary', id: 'backup-export', onclick: exportAll }, icon('download'), 'Yedek al'),
            el('button', { type: 'button', class: 'button button--quiet', id: 'backup-import', onclick: () => input.click() }, icon('upload'), 'Yedekten geri yükle'),
            input),
          el('p', { class: 'field__hint', text: 'Yedek; şarkıları, kategorileri, setlistleri (sıralarıyla) ve notaları (fotoğraflarıyla) içerir.' }),
          el('button', { type: 'button', class: 'button button--quiet button--small', id: 'backup-export-songs', onclick: exportSongs }, 'Seçtiğim şarkıları dosyaya aktar')),

        restorePanel(),

        el('section', { class: 'backup-info', 'aria-labelledby': 'backup-info-title' },
          el('h2', { class: 'section-title', id: 'backup-info-title', text: 'Verileriniz nerede, ne zaman kaybolabilir?' }),
          el('ul', { class: 'backup-info__list' },
            el('li', {}, el('strong', { text: 'Nerede: ' }), 'Bu cihazdaki tarayıcının içinde (IndexedDB adlı bölümde). Hiçbir sunucuya gönderilmez. Bilgisayardaki ve telefondaki uygulama birbirinden ayrıdır; birinden ötekine geçmek için yedek dosyasını kullanın.'),
            el('li', {}, el('strong', { text: 'Ne kadar yer: ' }), 'Binlerce şarkı yalnızca birkaç MB tutar; tarayıcı genellikle cihazın boş alanının büyük bölümünü kullanmaya izin verir. Nota fotoğrafları daha çok yer kaplar. Kullanılan alanı Durum ekranında görebilirsiniz.'),
            el('li', {}, el('strong', { text: 'Kaybolabileceği durumlar: ' }), 'tarayıcının “geçmişi / site verilerini temizle” işlemi; iPhone’da uygulamayı ana ekrandan silmek; Safari’de ana ekrana eklemeden kullanıp uzun süre açmamak; gizli sekmede kullanmak; cihazı sıfırlamak, kaybetmek ya da değiştirmek.'),
            el('li', {}, el('strong', { text: 'Öneri: ' }), `Önemli değişikliklerden sonra ve en az iki haftada bir yedek alın; dosyayı iCloud Drive, Google Drive ya da e-postanıza kaydedin. ${REMIND_AFTER_DAYS} günü geçince uygulama size hatırlatır.`)))));
  }

  return { show, openFile };
}
