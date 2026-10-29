/**
 * Onay penceresi: "Emin misiniz?" türündeki sorular için.
 * Tarayıcının kendi onay kutusu yerine uygulamanın görünümüne uyan bir pencere açar.
 * Sonuç: kullanıcı onaylarsa true, vazgeçerse (ya da Esc'ye basarsa) false.
 */
import { el } from '../lib/dom.js';

export function confirmDialog({ title, message, confirmLabel, cancelLabel = 'Vazgeç', danger = false }) {
  // Çok eski tarayıcılarda pencere öğesi yoksa tarayıcının kendi onay kutusu kullanılır.
  if (typeof HTMLDialogElement !== 'function') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }

  return new Promise((resolve) => {
    const cancelButton = el('button', { type: 'button', class: 'button button--quiet' }, cancelLabel);
    const confirmButton = el(
      'button',
      { type: 'button', class: danger ? 'button button--danger' : 'button button--primary' },
      confirmLabel
    );
    const dialog = el(
      'dialog',
      { class: 'dialog', 'aria-labelledby': 'dialog-title', 'aria-describedby': 'dialog-message' },
      el(
        'div',
        { class: 'dialog__body' },
        el('h2', { class: 'dialog__title', id: 'dialog-title', text: title }),
        el('p', { class: 'dialog__message', id: 'dialog-message', text: message }),
        el('div', { class: 'dialog__actions' }, cancelButton, confirmButton)
      )
    );

    let answered = false;
    const finish = (answer) => {
      if (answered) return;
      answered = true;
      dialog.close();
      dialog.remove();
      resolve(answer);
    };

    cancelButton.addEventListener('click', () => finish(false));
    confirmButton.addEventListener('click', () => finish(true));
    // Esc tuşu
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    // Pencerenin dışına dokunmak vazgeçmek sayılır.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });

    document.body.append(dialog);
    dialog.showModal();
    // Silme gibi geri alınamayan işlerde odak "Vazgeç"te başlar.
    (danger ? cancelButton : confirmButton).focus();
  });
}
