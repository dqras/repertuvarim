/**
 * "Ana ekrana ekle" düğmeleri ve adım adım rehber.
 *
 * - Şarkı listesinin üstünde bir kart: tek düğmeyle ekleme. "Şimdi değil" denirse
 *   iki hafta gizlenir.
 * - Durum ekranında her zaman bir düğme.
 * - Tarayıcı izin veriyorsa (Android/Windows Chrome ve Edge) tarayıcının kendi
 *   yükleme penceresi açılır; izin vermiyorsa (iPhone) kısa bir rehber gösterilir.
 * - Uygulama ana ekrandan açıldıysa bu düğmelerin hiçbiri görünmez.
 */
import { el } from '../lib/dom.js';

const SNOOZE_KEY = 'repertuvarim.anaEkranKarti';
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * installer: pwa.js createInstaller() sonucu.
 * card: listedeki #install-card; statusButton: Durum ekranındaki düğme.
 * onInstalled(): yükleme kabul edilince (mesaj göstermek için).
 */
export function setupInstallUi({ installer, card, statusButton, onInstalled }) {
  const cardButton = card.querySelector('#install-card-button');
  const laterButton = card.querySelector('#install-card-later');
  const cardText = card.querySelector('#install-card-text');

  async function start() {
    const result = await installer.install();
    if (result === 'manual') showGuide(installer.state());
    else if (result === 'accepted') onInstalled?.();
  }

  function update() {
    const { installed, platform } = installer.state();
    const isPhone = platform !== 'desktop';
    const label = isPhone ? 'Ana ekrana ekle' : 'Uygulama olarak yükle';
    cardButton.textContent = label;
    statusButton.textContent = label;
    cardText.textContent = isPhone
      ? 'Repertuvarım’ı ana ekranınıza ekleyin: uygulama gibi tek dokunuşla açılır ve internetsiz çalışır.'
      : 'Repertuvarım’ı bilgisayarınıza uygulama olarak yükleyin: kendi penceresinde açılır ve internetsiz çalışır.';
    statusButton.hidden = installed;
    card.hidden = installed || isSnoozed();
  }

  cardButton.addEventListener('click', start);
  statusButton.addEventListener('click', start);
  laterButton.addEventListener('click', () => {
    snooze();
    update();
  });
  installer.onChange(update);
  update();
}

function isSnoozed() {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    // Kaydedilemezse kart yalnızca bu açılışta gizlenir.
  }
}

// --- Rehber ----------------------------------------------------------------------

const SHARE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11v9h12v-9"/></svg>';
const MORE_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const PLUS_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
const MENU_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

function glyph(svg) {
  const span = el('span', { class: 'guide__glyph', 'aria-hidden': 'true' });
  span.innerHTML = svg;
  return span;
}

/** Cihaza uygun adımları bir pencerede gösterir. */
export function showGuide({ platform, inAppBrowser }) {
  let title;
  let intro = null;
  let steps;

  if (inAppBrowser) {
    title = 'Önce tarayıcıda açın';
    intro = 'Bu sayfa bir uygulamanın içinde açılmış. Ana ekrana eklemek için sayfayı tarayıcıda açmanız gerekiyor.';
    steps = [
      [platform === 'ios' ? 'Sağ üstteki ••• ya da paylaş düğmesine dokunun.' : 'Sağ üstteki ⋮ düğmesine dokunun.'],
      [platform === 'ios' ? '“Safari’de Aç” seçeneğine dokunun.' : '“Tarayıcıda aç” seçeneğine dokunun.'],
      ['Açılan sayfada “Ana ekrana ekle” düğmesine tekrar dokunun.'],
    ];
  } else if (platform === 'ios') {
    title = 'Ana ekrana ekleme';
    intro = 'Apple, sitelerin kendilerini ana ekrana eklemesine izin vermiyor. Bu işi üç dokunuşla Safari’den yapabilirsiniz:';
    steps = [
      [glyph(MORE_ICON), 'Ekranın altındaki ••• düğmesine dokunun. (Bazı iPhone’larda doğrudan paylaş düğmesi ', glyph(SHARE_ICON), ' görünür.)'],
      [glyph(SHARE_ICON), '“Paylaş”a dokunun, listede aşağı kaydırıp “Ana Ekrana Ekle”yi seçin.'],
      [glyph(PLUS_ICON), '“Web uygulaması olarak aç” seçeneği varsa açık bırakın ve sağ üstteki “Ekle”ye dokunun.'],
    ];
  } else if (platform === 'android') {
    title = 'Ana ekrana ekleme';
    intro = 'Tarayıcınız tek dokunuşla eklemeye izin vermedi. Menüden ekleyebilirsiniz:';
    steps = [
      [glyph(MENU_ICON), 'Tarayıcının sağ üstündeki ⋮ menüsüne dokunun.'],
      [glyph(PLUS_ICON), '“Uygulamayı yükle” ya da “Ana ekrana ekle”yi seçin.'],
      ['Açılan pencerede “Yükle”ye ya da “Ekle”ye dokunun.'],
    ];
  } else {
    title = 'Uygulama olarak yükleme';
    intro = 'Tarayıcınız tek tıkla yüklemeye izin vermedi. Menüden yükleyebilirsiniz:';
    steps = [
      [glyph(PLUS_ICON), 'Chrome ya da Edge’de: adres çubuğunun sağındaki “yükle” simgesine tıklayın ya da tarayıcı menüsünde (⋮ veya •••) adında “yükle” geçen seçeneği seçin.'],
      ['Mac’te Safari’de: “Dosya” menüsünden “Dock’a Ekle”yi seçin.'],
      ['Firefox uygulama olarak yüklemeyi desteklemiyor; bunun için Chrome ya da Edge kullanın.'],
    ];
  }

  const close = el('button', { type: 'button', class: 'button button--primary' }, 'Tamam');
  const dialog = el(
    'dialog',
    { class: 'dialog dialog--guide', 'aria-labelledby': 'guide-title' },
    el(
      'div',
      { class: 'dialog__body' },
      el('h2', { class: 'dialog__title', id: 'guide-title', text: title }),
      intro ? el('p', { class: 'dialog__message', text: intro }) : null,
      el('ol', { class: 'guide__steps' }, steps.map((parts) => el('li', { class: 'guide__step' }, el('span', {}, parts)))),
      el('div', { class: 'dialog__actions' }, close)
    )
  );
  const finish = () => {
    dialog.close();
    dialog.remove();
  };
  close.addEventListener('click', finish);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) finish();
  });
  document.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  close.focus();
  return dialog;
}
