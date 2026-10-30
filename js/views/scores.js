/**
 * Notalar bölümü.
 *
 *  #/notalar               bütün notalar
 *  #/nota/<id>             porte; alttan ton seçilince beste donanımıyla birlikte taşınır
 *  #/nota/yeni             yeni nota       #/nota/<id>/duzenle   düzenleme
 *
 * Nota girişi: ekrandaki tuşlarla (süre, değişim işareti, nota) ya da "nota kodu" ile.
 * Fotoğraftan okuma: "Fotoğraftan oku" ile bestenin fotoğrafı (bir ya da birkaç sayfa)
 * LEGATO nota okuyucusuna gönderilir (music/omr.js); okunan notalar forma yerleşir,
 * fotoğraf da karşılaştırmak için notanın yanında saklanır. İnternet gerekir.
 */
import { el, icon } from '../lib/dom.js';
import { compareText } from '../lib/text.js';
import { describeStorageError } from '../data/db.js';
import {
  DURATIONS, DURATION_NAMES, STEP_NAMES, SCORE_HEADER, TIME_SIGNATURES, allKeys, diatonic, fifthsOf,
  keyLabel, measureProblems, parseNotes, parseScoreImport, parseTime, serializeNotes, signatureLabel, transposeScore,
  transposeTargets,
} from '../music/notation.js';
import { watchStaff } from '../music/staff.js';
import { cleanTitle } from '../music/abc.js';
import { OmrError, readScorePhotos } from '../music/omr.js';

/** Notalar listesinde seçilen fotoğraflar: form açılınca okunmaya başlar. */
let pendingPhotos = null;

const PRIVACY = 'Fotoğraf, okunması için Hugging Face’teki ücretsiz LEGATO nota okuyucusuna gönderilir; internet gerekir. En iyi sonuç için notayı düz, iyi ışıkta ve sayfayı dolduracak şekilde çekin.';
import { confirmDialog } from './dialog.js';
import { showMessage } from './components.js';

const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const pcOf = (key) => (((NATURAL[key.step] + key.alter) % 12) + 12) % 12;
const sameKey = (a, b) => a.step === b.step && a.alter === b.alter && a.mode === b.mode;
const SCALE = { min: 0.7, max: 1.8, step: 0.1 };

function keyDescription(key) {
  return `${keyLabel(key)} (${signatureLabel(fifthsOf(key) ?? 0)})`;
}

// --- Liste ----------------------------------------------------------------------------

export function createScoresView(root) {
  function render(scores) {
    const sorted = [...scores].sort((a, b) => compareText(a.title, b.title));
    root.replaceChildren(
      el('div', { class: 'page page--screen' },
        el('h1', { class: 'screen-title', tabindex: '-1', text: 'Notalar' }),
        el('div', { class: 'setlist-view__actions' },
          photoPicker('score-photo-read', 'Fotoğraftan oku', true, (files) => {
            pendingPhotos = files;
            location.hash = '#/nota/yeni';
          }),
          el('a', { class: 'button button--quiet', id: 'score-new', href: '#/nota/yeni' }, icon('plus'), 'Elle yaz')),
        el('p', { class: 'field__hint score-privacy', text: PRIVACY }),
        sorted.length
          ? el('ul', { class: 'setlist-list', id: 'score-list', role: 'list' },
              sorted.map((score) =>
                el('li', { class: 'setlist-row' },
                  el('a', { class: 'setlist-row__link', href: `#/nota/${encodeURIComponent(score.id)}` },
                    el('span', { class: 'setlist-row__icon score-row__icon', 'aria-hidden': 'true', text: '♪' }),
                    el('span', { class: 'setlist-row__text' },
                      el('span', { class: 'setlist-row__title', text: score.title }),
                      el('span', { class: 'setlist-row__sub', text: [score.composer, keyDescription(score.key), score.time].filter(Boolean).join(' · ') }))))))
          : el('div', { class: 'empty empty--setlists' },
              el('p', { class: 'empty__title', text: 'Henüz nota yok' }),
              el('p', { class: 'muted', text: 'Notası yazılmış bir besteyi ekleyin; porte üzerinde görün ve istediğiniz tona, donanımıyla birlikte taşıyın.' }))
      )
    );
  }
  return { show: render, update: render };
}

// --- Nota ekranı (porte + transpoze) ----------------------------------------------------

/**
 * options: loadPrefs(id) → { target: {step, alter} | null, octave, scale, names }
 *          savePref(name, value, id)   name: 'target' | 'scale' | 'names'
 */
export function createScoreView(root, { loadPrefs, savePref }) {
  let current = null;
  let photoUrl = null;

  async function show(score) {
    hide();
    if (!score) {
      root.replaceChildren(el('div', { class: 'page page--screen' },
        el('h1', { class: 'screen-title', tabindex: '-1', text: 'Nota bulunamadı' }),
        el('a', { class: 'button button--quiet', href: '#/notalar' }, 'Notalara dön')));
      return;
    }
    const prefs = await loadPrefs(score.id);
    const parsed = parseNotes(score.code, score.key, parseTime(score.time));
    current = {
      score,
      measures: parsed.measures,
      offset: offsetOf(score.key, prefs.target),
      octave: [-1, 0, 1].includes(prefs.octave) ? prefs.octave : 0,
      scale: Math.min(SCALE.max, Math.max(SCALE.min, Number(prefs.scale) || 1)),
      names: prefs.names !== false,
      showPhoto: false,
    };
    render();
  }

  function hide() {
    current?.staff?.stop();
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = null;
    current = null;
  }

  /** Hedef tonun orijinalden kaç yarım ses uzakta olduğu (−5..6). */
  function offsetOf(source, target) {
    if (!target) return 0;
    let offset = (pcOf(target) - pcOf(source) + 12) % 12;
    if (offset > 6) offset -= 12;
    return offset;
  }

  function targetFor(offset) {
    const { key } = current.score;
    if (offset === 0) return key;
    const pc = (pcOf(key) + offset + 12) % 12;
    return transposeTargets(key.mode).find((item) => pcOf(item.key) === pc).key;
  }

  function view() {
    const { score, measures, offset, octave } = current;
    if (offset === 0 && octave === 0) return { measures, key: score.key, fifths: fifthsOf(score.key) ?? 0 };
    return transposeScore(measures, score.key, targetFor(offset), octave);
  }

  function render() {
    const { score } = current;
    const ui = {};
    ui.staff = el('div', { class: 'staff', id: 'score-staff', 'aria-label': 'Porte' });
    ui.status = el('div', { class: 'transpose-status', id: 'score-status', 'aria-live': 'polite' });
    ui.down = el('button', { type: 'button', class: 'bar-button', id: 'score-down', 'aria-label': 'Bir yarım ses aşağı', onclick: () => setOffset(current.offset - 1) }, icon('minus'));
    ui.up = el('button', { type: 'button', class: 'bar-button', id: 'score-up', 'aria-label': 'Bir yarım ses yukarı', onclick: () => setOffset(current.offset + 1) }, icon('plus'));
    ui.key = el('select', { class: 'bar-key', id: 'score-key', 'aria-label': 'Ton seç' });
    ui.key.addEventListener('change', () => setOffset(Number(ui.key.value)));
    ui.smaller = el('button', { type: 'button', class: 'bar-button bar-button--text', id: 'score-smaller', 'aria-label': 'Küçült', onclick: () => setScale(current.scale - SCALE.step) }, el('span', { class: 'bar-a bar-a--small', text: 'A' }));
    ui.bigger = el('button', { type: 'button', class: 'bar-button bar-button--text', id: 'score-bigger', 'aria-label': 'Büyüt', onclick: () => setScale(current.scale + SCALE.step) }, el('span', { class: 'bar-a', text: 'A' }));
    ui.names = el('button', { type: 'button', class: 'fav-toggle fav-toggle--plain', id: 'score-names', 'aria-pressed': String(current.names), onclick: toggleNames }, 'Nota adları');
    ui.photoButton = score.photo
      ? el('button', { type: 'button', class: 'fav-toggle fav-toggle--plain', id: 'score-photo-toggle', 'aria-pressed': 'false', onclick: togglePhoto }, icon('image'), 'Fotoğraf')
      : null;
    ui.photo = el('div', { class: 'score-photo', id: 'score-photo', hidden: true });

    for (let offset = -5; offset <= 6; offset += 1) {
      const key = targetFor(offset);
      const sign = offset === 0 ? 'orijinal' : `${offset > 0 ? '+' : '−'}${Math.abs(offset)}`;
      // Kısa yazı (alt çubuğa sığsın); donanım üstteki satırda yazar.
      ui.key.append(el('option', { value: String(offset), selected: offset === current.offset, 'aria-label': `${keyDescription(key)}, ${sign}` }, `${keyLabel(key)} · ${sign}`));
    }

    root.replaceChildren(
      el('article', { class: 'page page--screen song-view score-view' },
        el('header', { class: 'song-view__header' },
          el('h1', { class: 'screen-title', tabindex: '-1', text: score.title }),
          score.composer ? el('p', { class: 'song-detail__artist', text: score.composer }) : null,
          el('div', { class: 'song-meta' },
            el('span', { class: 'song-meta__item' }, 'Orijinal ton ', el('strong', { class: 'song-meta__key', text: keyDescription(score.key) })),
            el('span', { class: 'song-meta__item', text: `Ölçü ${score.time}` })),
          el('div', { class: 'song-detail__actions' },
            el('a', { class: 'pill-link', id: 'score-edit', href: `#/nota/${encodeURIComponent(score.id)}/duzenle` }, icon('edit'), 'Düzenle'),
            ui.names,
            ui.photoButton)),
        ui.photo,
        ui.status,
        current.measures.length ? ui.staff : el('p', { class: 'placeholder', text: 'Bu notaya henüz nota yazılmadı. Düzenle ile ekleyebilirsiniz.' }),
        score.notes ? el('details', { class: 'song-notes' }, el('summary', { text: 'Notlarım' }), el('p', { class: 'song-detail__notes-text', text: score.notes })) : null
      ),
      el('div', { class: 'song-bar', role: 'toolbar', 'aria-label': 'Ton ve boyut' },
        el('div', { class: 'song-bar__inner' },
          el('div', { class: 'song-bar__group' }, ui.down, ui.key, ui.up),
          el('div', { class: 'song-bar__group' }, ui.smaller, ui.bigger)))
    );
    current.ui = ui;
    if (current.measures.length) current.staff = watchStaff(ui.staff, () => ({ ...view(), time: parseTime(score.time), showNames: current.names, scale: current.scale, clef: score.clef }));
    drawStatus();
  }

  function drawStatus() {
    const { ui, offset, octave, scale } = current;
    const { key } = view();
    ui.key.value = String(offset);
    ui.smaller.disabled = scale <= SCALE.min + 1e-9;
    ui.bigger.disabled = scale >= SCALE.max - 1e-9;
    const octaveButtons = el('span', { class: 'score-octave' },
      el('button', { type: 'button', class: 'button button--quiet button--small', id: 'score-octave-down', disabled: octave <= -1, onclick: () => setOctave(octave - 1) }, 'Oktav aşağı'),
      el('button', { type: 'button', class: 'button button--quiet button--small', id: 'score-octave-up', disabled: octave >= 1, onclick: () => setOctave(octave + 1) }, 'Oktav yukarı'));
    const changed = offset !== 0 || octave !== 0;
    const parts = [];
    if (offset) parts.push(`orijinalden ${Math.abs(offset)} yarım ses ${offset > 0 ? 'yukarı' : 'aşağı'}`);
    if (octave) parts.push(`bir oktav ${octave > 0 ? 'yukarı' : 'aşağı'}`);
    ui.status.replaceChildren(
      el('p', { class: 'transpose-status__text' },
        changed ? 'Şimdiki ton ' : 'Ton ',
        el('strong', { class: 'song-meta__key', id: 'score-current-key', text: keyDescription(key) }),
        parts.length ? ` · ${parts.join(', ')}` : ''),
      el('div', { class: 'score-status__actions' },
        changed ? el('button', { type: 'button', class: 'button button--quiet button--small', id: 'score-reset', onclick: reset }, icon('reset'), 'Orijinal tona dön') : null,
        octaveButtons)
    );
  }

  function save() {
    const target = current.offset === 0 && current.octave === 0 ? null : { ...targetFor(current.offset), octave: current.octave };
    savePref('target', target, current.score.id);
  }

  function setOffset(value) {
    let offset = value;
    if (offset > 6) offset -= 12;
    if (offset < -5) offset += 12;
    current.offset = offset;
    save();
    drawStatus();
    current.staff?.refresh();
  }

  function setOctave(value) {
    current.octave = Math.max(-1, Math.min(1, value));
    save();
    drawStatus();
    current.staff?.refresh();
  }

  function reset() {
    current.offset = 0;
    current.octave = 0;
    save();
    drawStatus();
    current.staff?.refresh();
    current.ui.key.focus();
  }

  function setScale(value) {
    current.scale = Math.round(Math.min(SCALE.max, Math.max(SCALE.min, value)) * 10) / 10;
    savePref('scale', current.scale);
    drawStatus();
    current.staff?.refresh();
  }

  function toggleNames() {
    current.names = !current.names;
    current.ui.names.setAttribute('aria-pressed', String(current.names));
    savePref('names', current.names);
    current.staff?.refresh();
  }

  function togglePhoto() {
    current.showPhoto = !current.showPhoto;
    const { ui, score } = current;
    ui.photoButton.setAttribute('aria-pressed', String(current.showPhoto));
    if (current.showPhoto && !photoUrl) photoUrl = URL.createObjectURL(score.photo);
    ui.photo.replaceChildren(current.showPhoto ? el('img', { src: photoUrl, alt: `${score.title} notasının fotoğrafı` }) : '');
    ui.photo.hidden = !current.showPhoto;
  }

  return { show, hide };
}

// --- Düzenleme ----------------------------------------------------------------------------

/**
 * actions: save(fields, id | null) → nota, remove(id), leave()
 */
export function createScoreEditor(root, actions) {
  let state = null;

  function open(score = null) {
    const base = score ?? { title: '', composer: '', key: { step: 5, alter: 0, mode: 'minor' }, time: '4/4', clef: 'treble', code: '', notes: '', photo: null };
    state = {
      id: score?.id ?? null,
      baseline: JSON.stringify(snapshot(base)),
      photo: base.photo,
      photoUrl: null,
      dur: 4,
      dots: 0,
      accidental: null, // tek seferlik: 1, -1, 0
      octaveShift: 0,
      staff: null,
      reading: false,
    };
    readUndo = null;
    render(base);
    if (pendingPhotos && !score) {
      const files = pendingPhotos;
      pendingPhotos = null;
      readPhotos(files);
    }
  }

  // --- Fotoğraftan okuma ----------------------------------------------------------------

  let readUndo = null;

  function showReadNotice(children, { busy = false } = {}) {
    const box = state.ui.readNotice;
    box.replaceChildren(...children);
    box.hidden = false;
    box.classList.toggle('is-busy', busy);
  }

  async function readPhotos(files) {
    if (state.reading) return;
    state.reading = true;
    const { ui } = state;
    const before = readFields();
    const progressText = ({ step, page, pages }) => {
      const which = pages > 1 ? ` (${page}/${pages}. sayfa)` : '';
      if (step === 'waking') return `Nota okuyucusu uyanıyor${which}… İlk seferde bir-iki dakika sürebilir.`;
      if (step === 'upload') return `Fotoğraf gönderiliyor${which}…`;
      return `Notalar okunuyor${which}… Genellikle yarım dakika sürer.`;
    };
    showReadNotice([el('p', { class: 'notice__text', id: 'sc-read-progress' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), progressText({ step: 'upload', page: 1, pages: files.length }))], { busy: true });
    ui.readNotice.scrollIntoView({ block: 'center', behavior: 'smooth' });
    let result;
    try {
      result = await readScorePhotos(files, {
        onProgress: (progress) => {
          const text = document.getElementById('sc-read-progress');
          if (text) text.lastChild.textContent = progressText(progress);
        },
      });
    } catch (error) {
      state.reading = false;
      const reason = error instanceof OmrError ? error.reason : 'server';
      const messages = {
        offline: 'Fotoğraftan okumak için internet gerekiyor. Bağlantınızı kontrol edip tekrar deneyin.',
        image: 'Bu dosya açılamadı. Bir fotoğraf ya da PDF seçin.',
        empty: 'Fotoğrafta nota bulunamadı. Porteyi yakından, düz ve iyi ışıkta çekip tekrar deneyin.',
        busy: 'Nota okuyucusu şu an çok yoğun. Birkaç dakika sonra tekrar deneyin.',
        timeout: 'Okuma çok uzun sürdü. Biraz sonra tekrar deneyin.',
        server: 'Nota okuyucusuna şu an ulaşılamıyor. Biraz sonra tekrar deneyin; olmazsa notaları elle yazabilirsiniz.',
      };
      showReadNotice([el('p', { class: 'notice__text', text: messages[reason] ?? messages.server })]);
      return;
    }
    state.reading = false;

    // Forma yerleştir
    if (!ui.title.value.trim() && cleanTitle(result.title)) ui.title.value = cleanTitle(result.title);
    if (!ui.composer.value.trim() && cleanTitle(result.composer)) ui.composer.value = cleanTitle(result.composer);
    ui.key.value = `${result.key.step},${result.key.alter},${result.key.mode}`;
    if (!ui.key.value) ui.key.value = '0,0,major';
    if (TIME_SIGNATURES.includes(result.time)) ui.time.value = result.time;
    else {
      ui.time.append(el('option', { value: result.time }, result.time));
      ui.time.value = result.time;
    }
    ui.clef.value = result.clef;
    ui.code.value = serializeNotes(result.measures, result.key);
    if (!state.photo) {
      state.photo = await shrinkImage(files[0]).catch(() => null);
      drawPhoto();
    }
    root.querySelector('.score-code')?.removeAttribute('open');
    refresh();
    readUndo = { before, photoBefore: before.photo };

    const problems = measureProblems(result.measures, parseTime(result.time));
    const notes = [];
    notes.push(`${result.measures.length} ölçü okundu: ${keyLabel(result.key)}, ${result.time}${result.clef === 'bass' ? ', fa anahtarı' : ''}.`);
    if (problems.length) notes.push(`${problems.length} ölçünün süresi tutmuyor (porte altında yazıyor); fotoğrafla karşılaştırıp düzeltin.`);
    else notes.push('Okuma hatası olabilir: porteyi fotoğrafla karşılaştırın.');
    if (result.warnings.includes('chords')) notes.push('Akorlu yerlerde yalnızca en üstteki nota (ezgi) alındı.');
    if (result.failed?.length) notes.push(`${result.failed.map((f) => f.page).join(', ')}. sayfa okunamadı.`);
    showReadNotice([
      el('p', { class: 'notice__text', text: notes.join(' ') }),
      el('div', { class: 'notice__actions' },
        el('button', { type: 'button', class: 'button button--quiet button--small', id: 'sc-read-undo', onclick: undoRead }, 'Geri al')),
    ]);
    if (!ui.title.value.trim()) ui.title.focus();
  }

  function undoRead() {
    if (!readUndo) return;
    const { before, photoBefore } = readUndo;
    readUndo = null;
    const { ui } = state;
    ui.title.value = before.title;
    ui.composer.value = before.composer;
    ui.key.value = `${before.key.step},${before.key.alter},${before.key.mode}`;
    ui.time.value = before.time;
    ui.clef.value = before.clef;
    ui.code.value = before.code;
    state.photo = photoBefore;
    drawPhoto();
    refresh();
    state.ui.readNotice.hidden = true;
  }

  function snapshot(data) {
    return { title: data.title, composer: data.composer, key: data.key, time: data.time, clef: data.clef ?? 'treble', code: data.code, notes: data.notes, photo: data.photo ? data.photo.size : 0 };
  }

  function render(data) {
    const ui = {};
    state.ui = ui;
    ui.title = el('input', { class: 'input', id: 'sc-title', type: 'text', value: data.title, maxlength: '120', autocomplete: 'off' });
    ui.composer = el('input', { class: 'input', id: 'sc-composer', type: 'text', value: data.composer, maxlength: '120', autocomplete: 'off' });
    ui.key = el('select', { class: 'input', id: 'sc-key' });
    for (const [mode, label] of [['major', 'Majör'], ['minor', 'Minör']]) {
      const group = el('optgroup', { label });
      for (const item of allKeys(mode)) {
        const value = `${item.key.step},${item.key.alter},${mode}`;
        group.append(el('option', { value, selected: sameKey(item.key, data.key) }, `${keyLabel(item.key)} (${signatureLabel(item.fifths)})`));
      }
      ui.key.append(group);
    }
    ui.time = el('select', { class: 'input', id: 'sc-time' }, TIME_SIGNATURES.map((t) => el('option', { value: t, selected: t === data.time }, t)));
    ui.clef = el('select', { class: 'input', id: 'sc-clef' },
      el('option', { value: 'treble', selected: (data.clef ?? 'treble') === 'treble' }, 'Sol anahtarı'),
      el('option', { value: 'bass', selected: data.clef === 'bass' }, 'Fa anahtarı'));
    ui.code = el('textarea', { class: 'input input--code', id: 'sc-code', rows: '5', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', placeholder: 'ör. la4:4 si4 do5 re5 | mi5 fa5 sol#5 la5 |' });
    ui.code.value = data.code;
    ui.notes = el('textarea', { class: 'input', id: 'sc-notes', rows: '2' });
    ui.notes.value = data.notes;
    ui.preview = el('div', { class: 'staff score-preview', id: 'sc-preview' });
    ui.problems = el('p', { class: 'field__warning', id: 'sc-problems', hidden: true, 'aria-live': 'polite' });
    ui.titleError = el('p', { class: 'field__error', id: 'sc-title-error', hidden: true });
    ui.photoBox = el('div', { class: 'score-photo-field', id: 'sc-photo-box' });
    ui.photoInput = el('input', { type: 'file', accept: 'image/*', id: 'sc-photo-input', hidden: true });
    ui.photoInput.addEventListener('change', () => {
      const file = ui.photoInput.files[0];
      ui.photoInput.value = '';
      if (file) setPhoto(file);
    });

    const field = (id, label, control, extra = null) =>
      el('div', { class: 'field' }, el('label', { class: 'field__label', for: id, text: label }), control, extra);

    root.replaceChildren(
      el('div', { class: 'page page--screen' },
        el('form', { class: 'editor score-editor', novalidate: true, onsubmit: (event) => { event.preventDefault(); save(); } },
          el('h1', { class: 'screen-title', tabindex: '-1', text: state.id ? 'Notayı düzenle' : 'Yeni nota' }),
          el('div', { class: 'notice notice--import', id: 'sc-import' },
            el('p', { class: 'notice__text', text: state.id ? 'Notaları bir fotoğraftan yeniden okutabilirsiniz.' : 'Bestenin fotoğrafını seçin ya da çekin: notalar okunup buraya yerleşir. Birkaç sayfa ise hepsini sırayla seçin.' }),
            el('div', { class: 'notice__actions' },
              photoPicker('sc-photo-read', 'Fotoğraftan oku', true, (files) => readPhotos(files)),
              el('button', { type: 'button', class: 'button button--quiet button--small', id: 'sc-import-clipboard', onclick: importFromClipboard }, 'Panodan aktar')),
            el('p', { class: 'field__hint', text: PRIVACY })),
          ui.readNotice = el('div', { class: 'notice notice--sheet', id: 'sc-read-notice', 'aria-live': 'polite', hidden: true }),
          field('sc-title', 'Ad', ui.title, ui.titleError),
          field('sc-composer', 'Besteci', ui.composer),
          el('div', { class: 'field-row field-row--two' }, field('sc-key', 'Ton ve donanım', ui.key), field('sc-time', 'Ölçü', ui.time)),
          field('sc-clef', 'Anahtar', ui.clef),
          el('div', { class: 'field' },
            el('p', { class: 'field__label', text: 'Notalar' }),
            ui.preview,
            ui.problems,
            keyboard(ui),
            el('details', { class: 'score-code', open: data.code && !state.id ? true : null },
              el('summary', { text: 'Nota kodu' }),
              el('p', { class: 'field__hint', text: 'Her nota: ad + işaret + oktav + :süre. Örnek: la4:4 (dörtlük la), sol#5:8 (sekizlik sol diyez), do5:4. (noktalı dörtlük), sus:2 (ikilik sus), | ölçü çizgisi. Donanımdaki işaretleri yazmanıza gerek yok; kâğıtta nasıl görünüyorsa öyle yazın.' }),
              ui.code)),
          el('div', { class: 'field' },
            el('p', { class: 'field__label', text: 'Fotoğraf' }),
            el('p', { class: 'field__hint', text: 'Notanın fotoğrafını karşılaştırmak için yanında saklayabilirsiniz (yalnızca bu cihazda).' }),
            ui.photoBox, ui.photoInput),
          field('sc-notes', 'Notlarım', ui.notes),
          el('div', { class: 'editor__actions' },
            el('div', { class: 'editor__buttons' },
              el('button', { type: 'button', class: 'button button--quiet', onclick: () => actions.leave() }, 'Vazgeç'),
              el('button', { type: 'submit', class: 'button button--primary', id: 'sc-save' }, 'Kaydet'))),
          state.id ? el('section', { class: 'editor__danger' },
            el('button', { type: 'button', class: 'button button--danger-quiet', id: 'sc-delete', onclick: remove }, icon('trash'), 'Notayı sil')) : null))
    );

    for (const control of [ui.code, ui.key, ui.time, ui.clef]) control.addEventListener(control === ui.code ? 'input' : 'change', refresh);
    ui.title.addEventListener('input', () => { ui.titleError.hidden = true; ui.title.removeAttribute('aria-invalid'); });
    drawPhoto();
    state.staff?.stop();
    state.staff = watchStaff(ui.preview, () => previewOptions());
    refresh();
  }

  function readKey() {
    const [step, alter, mode] = state.ui.key.value.split(',');
    return { step: Number(step), alter: Number(alter), mode };
  }

  function parsed() {
    return parseNotes(state.ui.code.value, readKey(), parseTime(state.ui.time.value));
  }

  function previewOptions() {
    const key = readKey();
    return { measures: parsed().measures, fifths: fifthsOf(key) ?? 0, time: parseTime(state.ui.time.value), showNames: true, scale: 0.9, clef: state.ui.clef.value };
  }

  function refresh() {
    state.staff?.refresh();
    const { measures, errors } = parsed();
    const problems = measureProblems(measures, parseTime(state.ui.time.value));
    const parts = [];
    if (errors.length) parts.push(`Anlaşılmayan: ${errors.slice(0, 4).map((e) => `“${e.token}”`).join(', ')}.`);
    if (problems.length) parts.push(`Süresi ölçüye uymayan ölçü: ${problems.slice(0, 5).map((p) => p.index + 1).join(', ')}. ölçü.`);
    state.ui.problems.textContent = parts.join(' ');
    state.ui.problems.hidden = parts.length === 0;
    updateKeyboard();
  }

  // --- Dokunmatik nota klavyesi --------------------------------------------------------

  function keyboard(ui) {
    const durButtons = DURATIONS.map((dur) =>
      el('button', { type: 'button', class: 'kb-key kb-key--dur', dataset: { dur: String(dur) }, 'aria-pressed': String(dur === state.dur), title: DURATION_NAMES[dur], onclick: () => { state.dur = dur; updateKeyboard(); } },
        el('span', { class: 'kb-key__big', text: `1/${dur}`.replace('1/1', '1') }),
        el('span', { class: 'kb-key__small', text: DURATION_NAMES[dur] })));
    ui.dot = el('button', { type: 'button', class: 'kb-key', id: 'kb-dot', 'aria-pressed': 'false', onclick: () => { state.dots = state.dots ? 0 : 1; updateKeyboard(); } }, 'Noktalı');
    const accButtons = [[1, '♯', 'Diyez'], [-1, '♭', 'Bemol'], [0, '♮', 'Natürel']].map(([value, text, label]) =>
      el('button', { type: 'button', class: 'kb-key kb-key--acc', dataset: { acc: String(value) }, 'aria-pressed': 'false', 'aria-label': `${label} (sonraki notaya)`, title: `${label} (sonraki notaya)`, onclick: () => { state.accidental = state.accidental === value ? null : value; updateKeyboard(); } }, text));
    ui.octaveLabel = el('span', { class: 'kb-octave__label', id: 'kb-octave' });
    const noteButtons = STEP_NAMES.map((name, step) =>
      el('button', { type: 'button', class: 'kb-key kb-key--note', dataset: { step: String(step) }, onclick: () => addNote(step) }, name));
    return el('div', { class: 'keyboard', role: 'group', 'aria-label': 'Nota girişi' },
      el('div', { class: 'keyboard__row keyboard__row--dur' }, durButtons, ui.dot),
      el('div', { class: 'keyboard__row' },
        accButtons,
        el('span', { class: 'kb-octave' },
          el('button', { type: 'button', class: 'kb-key', id: 'kb-octave-down', 'aria-label': 'Sonraki nota bir oktav aşağı', onclick: () => shiftOctave(-1) }, '8↓'),
          ui.octaveLabel,
          el('button', { type: 'button', class: 'kb-key', id: 'kb-octave-up', 'aria-label': 'Sonraki nota bir oktav yukarı', onclick: () => shiftOctave(1) }, '8↑'))),
      el('div', { class: 'keyboard__row keyboard__row--notes' }, noteButtons),
      el('div', { class: 'keyboard__row' },
        el('button', { type: 'button', class: 'kb-key', id: 'kb-rest', onclick: addRest }, 'Sus'),
        el('button', { type: 'button', class: 'kb-key', id: 'kb-bar', onclick: addBar }, 'Ölçü çizgisi |'),
        el('button', { type: 'button', class: 'kb-key', id: 'kb-undo', 'aria-label': 'Son notayı sil', onclick: removeLast }, '⌫ Sil')));
  }

  function lastNote() {
    const flat = parsed().measures.flat().filter((item) => !item.rest);
    return flat[flat.length - 1] ?? null;
  }

  /** Bir sonraki notanın oktavı: önceki notaya en yakın + kaydırma. */
  function octaveFor(step) {
    const last = lastNote();
    const base = last ? Math.round((diatonic(last) - step) / 7) : state.ui.clef?.value === 'bass' ? 3 : 4;
    return Math.max(2, Math.min(7, base + state.octaveShift));
  }

  function updateKeyboard() {
    const root2 = state.ui;
    for (const button of root.querySelectorAll('.kb-key--dur')) button.setAttribute('aria-pressed', String(Number(button.dataset.dur) === state.dur));
    root2.dot?.setAttribute('aria-pressed', String(state.dots === 1));
    for (const button of root.querySelectorAll('.kb-key--acc')) button.setAttribute('aria-pressed', String(Number(button.dataset.acc) === state.accidental));
    if (root2.octaveLabel) {
      const last = lastNote();
      root2.octaveLabel.textContent = state.octaveShift ? `oktav ${state.octaveShift > 0 ? '+' : '−'}1` : last ? `${STEP_NAMES[last.step]}${last.octave}’den sonra` : 'oktav 4';
    }
  }

  function shiftOctave(delta) {
    state.octaveShift = Math.max(-1, Math.min(1, state.octaveShift + delta));
    updateKeyboard();
  }

  function append(token) {
    const area = state.ui.code;
    const text = area.value.replace(/\s+$/, '');
    area.value = text ? `${text} ${token}` : token;
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function durationText() {
    return `:${state.dur}${state.dots ? '.' : ''}`;
  }

  function addNote(step) {
    const sign = { 1: '#', '-1': 'b', 0: 'n' }[state.accidental] ?? '';
    append(`${STEP_NAMES[step]}${sign}${octaveFor(step)}${durationText()}`);
    state.accidental = null;
    state.octaveShift = 0;
    state.dots = 0;
    updateKeyboard();
  }

  function addRest() {
    append(`sus${durationText()}`);
    state.dots = 0;
    updateKeyboard();
  }

  function addBar() {
    append('|');
  }

  function removeLast() {
    const area = state.ui.code;
    area.value = area.value.replace(/\s*\S+\s*$/, '');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // --- Fotoğraf -------------------------------------------------------------------------

  async function setPhoto(file) {
    try {
      state.photo = await shrinkImage(file);
      drawPhoto();
    } catch {
      showMessage('Bu dosya açılamadı. Bir fotoğraf seçin.', { tone: 'error' });
    }
  }

  function drawPhoto() {
    const { ui } = state;
    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
    state.photoUrl = state.photo ? URL.createObjectURL(state.photo) : null;
    ui.photoBox.replaceChildren(
      state.photo ? el('img', { class: 'score-photo-field__img', src: state.photoUrl, alt: 'Notanın fotoğrafı' }) : null,
      el('div', { class: 'editor__tools' },
        el('button', { type: 'button', class: 'button button--quiet button--small', id: 'sc-photo-add', onclick: () => ui.photoInput.click() }, icon('image'), state.photo ? 'Fotoğrafı değiştir' : 'Fotoğraf ekle'),
        state.photo ? el('button', { type: 'button', class: 'button button--danger-quiet button--small', id: 'sc-photo-remove', onclick: () => { state.photo = null; drawPhoto(); } }, 'Kaldır') : null)
    );
  }

  // --- Aktarma, kaydetme, silme ----------------------------------------------------------

  async function importFromClipboard() {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      showMessage('Panoya erişilemedi. Metni “Nota kodu” kutusuna yapıştırın.', { tone: 'error', duration: 7000 });
      return;
    }
    if (!applyImport(text)) {
      showMessage(`Panodaki metin bir nota aktarımı değil (“${SCORE_HEADER}” ile başlamalı).`, { tone: 'error', duration: 7000 });
    }
  }

  function applyImport(text) {
    const data = parseScoreImport(text);
    if (!data) return false;
    const { ui } = state;
    if (data.title) ui.title.value = data.title;
    if (data.composer) ui.composer.value = data.composer;
    if (data.key && fifthsOf(data.key) !== null) ui.key.value = `${data.key.step},${data.key.alter},${data.key.mode}`;
    if (TIME_SIGNATURES.includes(data.time)) ui.time.value = data.time;
    ui.code.value = data.code;
    root.querySelector('.score-code')?.setAttribute('open', '');
    refresh();
    showMessage(`“${data.title || 'Nota'}” aktarıldı. Porteyi fotoğrafla karşılaştırıp Kaydet’e basın.`);
    return true;
  }

  function readFields() {
    const { ui } = state;
    return { title: ui.title.value.trim(), composer: ui.composer.value.trim(), key: readKey(), time: ui.time.value, clef: ui.clef.value, code: ui.code.value.trim(), notes: ui.notes.value, photo: state.photo };
  }

  async function save() {
    const fields = readFields();
    if (!fields.title) {
      state.ui.titleError.textContent = 'Notanın adını yazın.';
      state.ui.titleError.hidden = false;
      state.ui.title.setAttribute('aria-invalid', 'true');
      state.ui.title.focus();
      return;
    }
    try {
      const saved = await actions.save(fields, state.id);
      state.baseline = JSON.stringify(snapshot(saved));
    } catch (error) {
      showMessage(describeStorageError(error), { tone: 'error' });
    }
  }

  async function remove() {
    const ok = await confirmDialog({ title: 'Nota silinsin mi?', message: 'Bu nota ve fotoğrafı silinir. Bu işlem geri alınamaz.', confirmLabel: 'Notayı sil', danger: true });
    if (!ok) return;
    state.baseline = JSON.stringify(snapshot(readFields()));
    await actions.remove(state.id);
  }

  /** Kaydedilmemiş değişiklik varsa sorar; çıkılabiliyorsa true. */
  async function requestLeave() {
    if (!state) return true;
    if (state.reading) {
      return confirmDialog({ title: 'Okuma sürüyor', message: 'Fotoğraf hâlâ okunuyor. Çıkarsanız sonuç kaybolur.', confirmLabel: 'Çık', cancelLabel: 'Bekle', danger: true });
    }
    if (JSON.stringify(snapshot(readFields())) === state.baseline) return true;
    return confirmDialog({ title: 'Değişiklikler kaydedilmesin mi?', message: 'Bu notada yaptığınız değişiklikler silinir.', confirmLabel: 'Değişiklikleri at', cancelLabel: 'Düzenlemeye dön', danger: true });
  }

  function close() {
    state?.staff?.stop();
    if (state?.photoUrl) URL.revokeObjectURL(state.photoUrl);
  }

  return { open, requestLeave, close, applyImport };
}

/** Fotoğrafı en uzun kenarı 1600 piksel olacak şekilde küçültüp JPEG olarak döndürür. */
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), 'image/jpeg', 0.85));
}

/** "Fotoğraftan oku" düğmesi: kamera ya da fotoğraflar; birden çok sayfa seçilebilir. */
function photoPicker(id, label, primary, onFiles) {
  const input = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, id: `${id}-input`, hidden: true });
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) onFiles(files);
  });
  const button = el('button', { type: 'button', class: `button ${primary ? 'button--primary' : 'button--quiet'} button--small`, id, onclick: () => input.click() }, icon('image'), label);
  return el('span', { class: 'photo-picker' }, button, input);
}
