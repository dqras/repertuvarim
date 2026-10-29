/**
 * Şarkı ekleme ve düzenleme ekranı.
 *
 * - Yazdıklarınız kısa aralıklarla taslak olarak kaydedilir; uygulama yanlışlıkla
 *   kapanırsa bir sonraki açılışta kaldığınız yerden devam edersiniz.
 * - "Kaydet" alanları denetler; eksik ya da hatalı alanın altında ne yapılacağı yazar.
 * - Akorları ayrı satırlarda olan bir metin yapıştırılırsa tek dokunuşla [Am] biçimine
 *   çevrilebilir (Geri al ile eski hâline döner). Tanınmayan akorlar için uyarı çıkar.
 * - Düzenlerken en altta "Şarkıyı sil" bulunur ve önce onay ister.
 *
 * Bu ekran veritabanını doğrudan bilmez; kaydetme, silme ve taslak işlerini
 * app.js'nin verdiği "actions" fonksiyonlarıyla yapar.
 */
import { el, icon } from '../lib/dom.js';
import {
  MAX_CAPO,
  emptySongForm,
  sameForm,
  songToForm,
  validateSongForm,
} from '../data/model.js';
import { analyzeChords, convertChordSheet, countChordLines } from '../music/song-text.js';
import { confirmDialog } from './dialog.js';

const DRAFT_DELAY_MS = 800; // yazmayı bıraktıktan bu kadar sonra taslak kaydedilir
const HELPER_DELAY_MS = 250; // söz alanındaki akor denetimi bu kadar sonra yapılır
const KEY_SUGGESTIONS = [
  'C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm',
];
const FIELD_ORDER = ['title', 'artist', 'key', 'capo', 'bpm', 'content'];

/**
 * root: #view-editor bölümü. categories: kategori listesi.
 * actions:
 *   loadDraft(key) → taslak | null      saveDraft(key, form)      deleteDraft(key)
 *   save(value, songId | null) → şarkı  (kaydeder ve uygun ekrana geçer)
 *   remove(songId)                       (siler ve listeye döner)
 *   leave()                              (Vazgeç: geri düğmesiyle aynı işi yapar)
 */
export function createSongEditor(root, { categories, actions }) {
  let session = null;

  /** Ekranı açar. song verilirse düzenleme, verilmezse yeni şarkı. */
  async function open({ song = null } = {}) {
    await suspend();
    const key = song ? song.id : 'new';
    const baseline = song ? songToForm(song) : emptySongForm();
    let form = { ...baseline, categoryIds: [...baseline.categoryIds] };
    let restoredAt = null;
    try {
      const draft = await actions.loadDraft(key);
      if (draft?.form && !sameForm(draft.form, baseline)) {
        form = { ...emptySongForm(), ...draft.form };
        restoredAt = draft.updatedAt;
      }
    } catch (error) {
      console.error('Taslak okunamadı:', error);
    }
    session = { key, songId: song?.id ?? null, songTitle: song?.title ?? '', baseline, timer: 0, saving: false };
    render(form, { isEdit: Boolean(song), restoredAt });
  }

  /** Ekrandan ayrılırken (ör. tarayıcının geri tuşu) bekleyen taslağı hemen kaydeder. */
  async function suspend() {
    if (!session) return;
    await flushDraft();
    session = null;
  }

  /**
   * Geri ya da Vazgeç: değişiklik varsa kullanıcıya sorar.
   * Ekrandan çıkılabilecekse true döner.
   */
  async function requestLeave() {
    if (!session) return true;
    const form = readForm();
    if (!sameForm(form, session.baseline)) {
      const discard = await confirmDialog({
        title: 'Değişiklikler kaydedilmesin mi?',
        message: 'Bu ekranda yaptığınız değişiklikler silinir.',
        confirmLabel: 'Değişiklikleri at',
        cancelLabel: 'Düzenlemeye dön',
        danger: true,
      });
      if (!discard) return false;
    }
    clearTimeout(session.timer);
    await actions.deleteDraft(session.key).catch((error) => console.error('Taslak silinemedi:', error));
    session = null;
    return true;
  }

  // --- Çizim ---------------------------------------------------------------

  let ui = {};

  function render(form, { isEdit, restoredAt }) {
    const title = isEdit ? 'Şarkıyı düzenle' : 'Yeni şarkı';

    ui = {
      title: textInput('ed-title', form.title, { maxlength: '200', autocomplete: 'off', enterkeyhint: 'next' }),
      artist: textInput('ed-artist', form.artist, { maxlength: '200', autocomplete: 'off', enterkeyhint: 'next' }),
      key: textInput('ed-key', form.key, {
        maxlength: '6', list: 'ed-key-list', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        placeholder: 'ör. Am',
      }),
      capo: el(
        'select',
        { class: 'select', id: 'ed-capo', name: 'capo' },
        Array.from({ length: MAX_CAPO + 1 }, (_, fret) =>
          el('option', { value: String(fret), selected: Number(form.capo) === fret }, fret === 0 ? 'Yok' : String(fret))
        )
      ),
      bpm: textInput('ed-bpm', form.bpm, { inputmode: 'numeric', maxlength: '3', autocomplete: 'off', placeholder: 'ör. 92' }),
      content: el('textarea', {
        class: 'textarea textarea--lyrics', id: 'ed-content', name: 'content', rows: '12',
        spellcheck: 'false', autocorrect: 'off', autocapitalize: 'sentences',
      }),
      notes: el('textarea', { class: 'textarea', id: 'ed-notes', name: 'notes', rows: '3' }),
      favorite: el('button', { type: 'button', class: 'fav-toggle', id: 'ed-favorite' }),
      categories: el(
        'div',
        { class: 'chips chips--wrap', id: 'ed-categories', role: 'group', 'aria-label': 'Kategoriler' },
        categories.map((category) =>
          el(
            'button',
            {
              type: 'button',
              class: 'chip chip--category',
              dataset: { id: category.id, color: category.color },
              'aria-pressed': String(form.categoryIds.includes(category.id)),
            },
            category.name
          )
        )
      ),
      sheetNotice: el('div', { class: 'notice notice--sheet', id: 'ed-sheet-notice', 'aria-live': 'polite', hidden: true }),
      chordHint: el('p', { class: 'field__warning', id: 'ed-chord-hint', 'aria-live': 'polite', hidden: true }),
      status: el('p', { class: 'editor__status', 'aria-live': 'polite' }),
      save: el('button', { type: 'submit', class: 'button button--primary' }, 'Kaydet'),
      cancel: el('button', { type: 'button', class: 'button button--quiet' }, 'Vazgeç'),
    };
    ui.content.value = form.content;
    ui.notes.value = form.notes;
    setFavorite(form.favorite);

    const chordButton = el(
      'button',
      { type: 'button', class: 'button button--quiet button--small', id: 'ed-insert-chord' },
      el('span', { class: 'chord-brackets', 'aria-hidden': 'true', text: '[ ]' }),
      'Akor ekle'
    );

    const restoredNotice = restoredAt
      ? el(
          'div',
          { class: 'notice', id: 'ed-restored' },
          el('p', { class: 'notice__text', text: `Kaydedilmemiş değişiklikleriniz geri yüklendi (${formatTime(restoredAt)}).` }),
          el('button', { type: 'button', class: 'button button--quiet button--small', onclick: discardDraft }, 'Değişiklikleri at')
        )
      : null;

    const formElement = el(
      'form',
      { class: 'editor', novalidate: true },
      el('h1', { class: 'screen-title', tabindex: '-1', text: title }),
      restoredNotice,
      field('ed-title', 'Şarkı adı', ui.title, { required: true }),
      field('ed-artist', 'Sanatçı', ui.artist),
      el(
        'div',
        { class: 'field-row' },
        field('ed-key', 'Orijinal ton', ui.key),
        field('ed-capo', 'Kapo', ui.capo),
        field('ed-bpm', 'Tempo (BPM)', ui.bpm)
      ),
      el('datalist', { id: 'ed-key-list' }, KEY_SUGGESTIONS.map((name) => el('option', { value: name }))),
      field('ed-content', 'Söz ve akorlar', ui.content, {
        required: true,
        hint: 'Akoru, sözün çalındığı yere köşeli parantezle yazın: [Am]Bu gece yine aklımdasın',
        // Çevirme önerisi metin kutusunun üstünde: uzun bir şarkı yapıştırılınca da görünür.
        tools: [el('div', { class: 'editor__tools' }, chordButton), ui.sheetNotice],
        extra: [ui.chordHint],
      }),
      el(
        'fieldset',
        { class: 'field fieldset' },
        el('legend', { class: 'field__label', text: 'Kategoriler' }),
        ui.categories
      ),
      el('div', { class: 'field' }, el('p', { class: 'field__label', text: 'Favori' }), ui.favorite),
      field('ed-notes', 'Notlarım', ui.notes),
      el('div', { class: 'editor__actions' }, ui.status, el('div', { class: 'editor__buttons' }, ui.cancel, ui.save)),
      isEdit
        ? el(
            'section',
            { class: 'editor__danger', 'aria-label': 'Şarkıyı sil' },
            el('button', { type: 'button', class: 'button button--danger-quiet', onclick: removeSong }, icon('trash'), 'Şarkıyı sil')
          )
        : null
    );

    root.replaceChildren(el('div', { class: 'page page--screen' }, formElement));
    // Ekran görünür olduktan sonra metin alanlarını içeriğe göre boyutlandır.
    requestAnimationFrame(() => {
      autosize(ui.content);
      autosize(ui.notes);
    });
    setStatus(restoredAt ? 'restored' : 'clean');
    sheetUndo = null;
    refreshContentHelpers();

    // --- Olaylar ---
    formElement.addEventListener('input', onEdit);
    formElement.addEventListener('change', onEdit);
    formElement.addEventListener('submit', (event) => {
      event.preventDefault();
      save();
    });
    formElement.addEventListener('keydown', (event) => {
      // Bilgisayarda Ctrl+S (Mac'te Cmd+S) ile kaydet
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    });
    ui.categories.addEventListener('click', (event) => {
      const chip = event.target.closest('button[data-id]');
      if (!chip) return;
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
      onEdit();
    });
    ui.favorite.addEventListener('click', () => {
      setFavorite(ui.favorite.getAttribute('aria-pressed') !== 'true');
      onEdit();
    });
    ui.cancel.addEventListener('click', () => actions.leave());
    ui.key.addEventListener('blur', () => {
      // "am" yazıldıysa "Am" olarak düzelt; tanınmıyorsa olduğu gibi bırak (kaydederken uyarılır).
      const tidy = validateSongForm({ ...readForm(), key: ui.key.value }).value.key;
      if (tidy && tidy !== ui.key.value) {
        ui.key.value = tidy;
        onEdit();
      }
    });

    // Akor ekle: telefonda klavye kapanmasın diye düğmeye basınca odak metin alanında kalır.
    let selection = [form.content.length, form.content.length];
    const rememberSelection = () => {
      selection = [ui.content.selectionStart, ui.content.selectionEnd];
    };
    for (const type of ['keyup', 'mouseup', 'select', 'input', 'blur']) ui.content.addEventListener(type, rememberSelection);
    for (const type of ['pointerdown', 'mousedown']) chordButton.addEventListener(type, (event) => event.preventDefault());
    chordButton.addEventListener('click', () => {
      const area = ui.content;
      const [start, end] = document.activeElement === area ? [area.selectionStart, area.selectionEnd] : selection;
      const selected = area.value.slice(start, end);
      area.focus();
      area.setRangeText(`[${selected}]`, start, end, 'end');
      if (!selected) area.setSelectionRange(start + 1, start + 1);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  // --- Söz alanı yardımcıları: akor satırı çevirme ve tanınmayan akorlar -----------

  let sheetUndo = null; // { before, after, converted } — son çevirmeyi geri almak için
  let helperTimer = 0;

  function refreshContentHelpers() {
    clearTimeout(helperTimer);
    const content = ui.content.value;

    if (sheetUndo && content !== sheetUndo.after) sheetUndo = null;
    const chordLines = sheetUndo ? 0 : countChordLines(content);
    if (sheetUndo) {
      ui.sheetNotice.replaceChildren(
        el('p', { class: 'notice__text', text: `${sheetUndo.converted} akor satırı sözlerin içine yerleştirildi.` }),
        el('button', { type: 'button', class: 'button button--quiet button--small', id: 'ed-sheet-undo', onclick: undoSheet }, 'Geri al')
      );
    } else if (chordLines > 0) {
      ui.sheetNotice.replaceChildren(
        el('p', {
          class: 'notice__text',
          text: `Akorlar ayrı satırlarda görünüyor (${chordLines} satır). Sözlerin içine yerleştirilsin mi?`,
        }),
        el('button', { type: 'button', class: 'button button--primary button--small', id: 'ed-sheet-convert', onclick: convertSheet }, 'Akorları yerleştir')
      );
    }
    ui.sheetNotice.hidden = !sheetUndo && chordLines === 0;

    const { unknown, emptyCount } = analyzeChords(content);
    const parts = [];
    if (unknown.length) {
      const names = unknown.slice(0, 6).join(', ') + (unknown.length > 6 ? ' …' : '');
      parts.push(`Tanınmayan akor: ${names}. Ton değiştirilirken bunlar olduğu gibi kalır.`);
    }
    if (emptyCount) parts.push('Boş akor parantezi var: [ ]. İçine akorun adını yazın ya da silin.');
    ui.chordHint.textContent = parts.join(' ');
    ui.chordHint.hidden = parts.length === 0;
  }

  function setContent(value) {
    ui.content.value = value;
    ui.content.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function convertSheet() {
    const before = ui.content.value;
    const { text, converted } = convertChordSheet(before);
    if (!converted) return;
    sheetUndo = { before, after: text, converted };
    setContent(text);
    refreshContentHelpers();
    root.querySelector('#ed-sheet-undo')?.focus({ preventScroll: true });
  }

  function undoSheet() {
    if (!sheetUndo) return;
    const { before } = sheetUndo;
    sheetUndo = null;
    setContent(before);
    refreshContentHelpers();
    ui.content.focus({ preventScroll: true });
  }

  function setFavorite(favorite) {
    ui.favorite.setAttribute('aria-pressed', String(favorite));
    ui.favorite.replaceChildren(icon(favorite ? 'star' : 'starOutline'), favorite ? 'Favorilerde' : 'Favorilere ekle');
  }

  function readForm() {
    return {
      title: ui.title.value,
      artist: ui.artist.value,
      key: ui.key.value,
      content: ui.content.value,
      categoryIds: [...ui.categories.querySelectorAll('button[aria-pressed="true"]')].map((chip) => chip.dataset.id),
      capo: Number(ui.capo.value),
      bpm: ui.bpm.value,
      notes: ui.notes.value,
      favorite: ui.favorite.getAttribute('aria-pressed') === 'true',
    };
  }

  // --- Taslak --------------------------------------------------------------

  function onEdit(event) {
    if (!session) return;
    if (event?.target?.id) clearError(event.target.id);
    if (event?.target === ui.content || event?.target === ui.notes) autosize(event.target);
    if (event?.target === ui.content) {
      clearTimeout(helperTimer);
      helperTimer = setTimeout(refreshContentHelpers, HELPER_DELAY_MS);
    }
    clearTimeout(session.timer);
    setStatus('pending');
    session.timer = setTimeout(saveDraftNow, DRAFT_DELAY_MS);
  }

  async function flushDraft() {
    if (!session?.timer) return;
    clearTimeout(session.timer);
    session.timer = 0;
    await saveDraftNow();
  }

  async function saveDraftNow() {
    if (!session) return;
    const current = session;
    current.timer = 0;
    const form = readForm();
    try {
      if (sameForm(form, current.baseline)) {
        await actions.deleteDraft(current.key);
        if (session === current) setStatus('clean');
      } else {
        const draft = await actions.saveDraft(current.key, form);
        if (session === current) setStatus('saved', draft.updatedAt);
      }
    } catch (error) {
      console.error('Taslak kaydedilemedi:', error);
      if (session === current) setStatus('error');
    }
  }

  async function discardDraft() {
    if (!session) return;
    clearTimeout(session.timer);
    await actions.deleteDraft(session.key).catch((error) => console.error('Taslak silinemedi:', error));
    const { baseline } = session;
    render({ ...baseline, categoryIds: [...baseline.categoryIds] }, {
      isEdit: Boolean(session.songId),
      restoredAt: null,
    });
    ui.title.focus();
  }

  function setStatus(state, time) {
    const texts = {
      clean: 'Değişiklik yok.',
      restored: 'Taslaktan devam ediyorsunuz.',
      pending: 'Değişiklikler taslağa kaydediliyor…',
      saved: `Taslak kaydedildi (${formatTime(time)}).`,
      error: 'Taslak kaydedilemedi. Değişiklikleri kaybetmemek için Kaydet’e basın.',
    };
    ui.status.textContent = texts[state];
    ui.status.dataset.state = state;
  }

  // --- Kaydet ve sil ---------------------------------------------------------

  async function save() {
    if (!session || session.saving) return;
    const { valid, errors, value } = validateSongForm(readForm());
    for (const name of FIELD_ORDER) {
      if (errors[name]) showError(`ed-${name}`, errors[name]);
      else clearError(`ed-${name}`);
    }
    if (!valid) {
      const first = FIELD_ORDER.find((name) => errors[name]);
      const control = ui[first];
      control.scrollIntoView({ block: 'center', behavior: 'smooth' });
      control.focus({ preventScroll: true });
      return;
    }
    const current = session;
    current.saving = true;
    clearTimeout(current.timer);
    ui.save.disabled = true;
    try {
      await actions.save(value, current.songId);
      if (session === current) session = null;
    } catch (error) {
      console.error('Şarkı kaydedilemedi:', error);
    } finally {
      current.saving = false;
      ui.save.disabled = false;
    }
  }

  async function removeSong() {
    if (!session?.songId) return;
    const name = ui.title.value.trim() || session.songTitle;
    const confirmed = await confirmDialog({
      title: 'Şarkı silinsin mi?',
      message: `“${name}” kalıcı olarak silinir. Bu işlem geri alınamaz.`,
      confirmLabel: 'Şarkıyı sil',
      danger: true,
    });
    if (!confirmed || !session) return;
    const current = session;
    clearTimeout(current.timer);
    try {
      await actions.remove(current.songId);
      if (session === current) session = null;
    } catch (error) {
      console.error('Şarkı silinemedi:', error);
    }
  }

  // --- Alan yardımcıları -----------------------------------------------------

  function showError(id, message) {
    const control = root.querySelector(`#${id}`);
    const box = root.querySelector(`#${id}-error`);
    if (!control || !box) return;
    box.textContent = message;
    box.hidden = false;
    control.setAttribute('aria-invalid', 'true');
  }

  function clearError(id) {
    const control = root.querySelector(`#${id}`);
    const box = root.querySelector(`#${id}-error`);
    if (!control || !box || box.hidden) return;
    box.hidden = true;
    box.textContent = '';
    control.removeAttribute('aria-invalid');
  }

  return { open, suspend, requestLeave, flush: flushDraft };
}

function textInput(id, value, attributes = {}) {
  const input = el('input', { class: 'input', id, name: id.replace('ed-', ''), type: 'text', ...attributes });
  input.value = value ?? '';
  return input;
}

/** Etiket, isteğe bağlı açıklama, alanın kendisi, ek bilgiler ve hata yeri. */
function field(id, label, control, { required = false, hint = '', tools = null, extra = [] } = {}) {
  const described = [hint ? `${id}-hint` : null, `${id}-error`].filter(Boolean).join(' ');
  control.setAttribute('aria-describedby', described);
  if (required) control.setAttribute('aria-required', 'true');
  return el(
    'div',
    { class: 'field' },
    el('label', { class: 'field__label', for: id }, label, required ? el('span', { class: 'field__required', text: ' (zorunlu)' }) : null),
    hint ? el('p', { class: 'field__hint', id: `${id}-hint`, text: hint }) : null,
    tools,
    control,
    extra,
    el('p', { class: 'field__error', id: `${id}-error`, hidden: true })
  );
}

/** Metin alanı yazdıkça uzar; sayfa içinde ayrıca kaydırma gerekmez. */
function autosize(area) {
  if (!area.isConnected || area.offsetParent === null) return; // gizliyken ölçülemez
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

function formatTime(time) {
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(time ?? Date.now());
}
