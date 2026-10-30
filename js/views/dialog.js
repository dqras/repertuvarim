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

/** Ortak pencere iskeleti: kapatınca kaldırılır, Esc ve dışarı dokunma "vazgeç" sayılır. */
function openDialog({ className = '', labelledBy, children, onCancel }) {
  const dialog = el('dialog', { class: `dialog ${className}`.trim(), 'aria-labelledby': labelledBy }, el('div', { class: 'dialog__body' }, children));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    onCancel();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) onCancel();
  });
  document.body.append(dialog);
  dialog.showModal();
  return () => {
    dialog.close();
    dialog.remove();
  };
}

/**
 * Ad sorma penceresi (yeni kategori, setlisti yeniden adlandır…).
 * validate(name) → '' (uygun) ya da hata mesajı; submit(name) → Promise (hata fırlatırsa mesajı gösterilir).
 * extra: ad kutusunun altına eklenecek öğe (ör. renk seçici).
 * secondary: soldaki ek düğmenin yazısı (ör. "Kategoriyi sil"); basılırsa { secondary: true } döner.
 * Sonuç: kaydedilirse submit'in sonucu, vazgeçilirse null.
 */
export function nameDialog({ title, label, value = '', confirmLabel = 'Kaydet', placeholder = '', extra = null, secondary = null, maxLength = 40, inputType = 'text', submit }) {
  return new Promise((resolve) => {
    if (typeof HTMLDialogElement !== 'function') {
      const answer = window.prompt(title, value);
      if (answer === null) return resolve(null);
      Promise.resolve(submit(answer)).then(resolve, (error) => {
        window.alert(error?.detail || error?.message || 'Kaydedilemedi.');
        resolve(null);
      });
      return;
    }
    const input = el('input', { class: 'input', id: 'name-dialog-input', type: inputType, value, maxlength: String(maxLength), placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    const error = el('p', { class: 'field__error', id: 'name-dialog-error', hidden: true, 'aria-live': 'polite' });
    const cancelButton = el('button', { type: 'button', class: 'button button--quiet' }, 'Vazgeç');
    const okButton = el('button', { type: 'submit', class: 'button button--primary' }, confirmLabel);
    const form = el(
      'form',
      { class: 'dialog__form', novalidate: true },
      el('h2', { class: 'dialog__title', id: 'name-dialog-title', text: title }),
      el('label', { class: 'field__label', for: 'name-dialog-input', text: label }),
      input,
      error,
      extra,
      el('div', { class: 'dialog__actions' },
        secondary ? el('button', { type: 'button', class: 'button button--danger-quiet dialog__secondary', id: 'name-dialog-secondary', onclick: () => finish({ secondary: true }) }, secondary) : null,
        cancelButton,
        okButton)
    );
    let done = false;
    const finish = (answer) => {
      if (done) return;
      done = true;
      close();
      resolve(answer);
    };
    const close = openDialog({ labelledBy: 'name-dialog-title', children: form, onCancel: () => finish(null) });
    cancelButton.addEventListener('click', () => finish(null));
    input.addEventListener('input', () => {
      error.hidden = true;
      input.removeAttribute('aria-invalid');
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      okButton.disabled = true;
      try {
        finish(await submit(input.value));
      } catch (problem) {
        error.textContent = problem?.detail || 'Kaydedilemedi. Tekrar deneyin.';
        error.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      } finally {
        okButton.disabled = false;
      }
    });
    input.focus();
    input.select();
  });
}

/**
 * Çoklu seçim penceresi: aramalı, onay kutulu liste.
 * items: [{ id, label, sublabel, checked, disabled }]
 * Sonuç: seçilen kimlikler (Array) ya da vazgeçilirse null.
 */
export function pickDialog({ title, items, confirmLabel = 'Ekle', emptyText = 'Liste boş.', searchable = true, footer = null }) {
  return new Promise((resolve) => {
    const selected = new Set(items.filter((item) => item.checked && !item.disabled).map((item) => item.id));
    const search = searchable
      ? el('input', { class: 'input', type: 'search', id: 'pick-search', placeholder: 'Ara', 'aria-label': 'Ara', autocomplete: 'off' })
      : null;
    const list = el('ul', { class: 'pick-list', id: 'pick-list', role: 'list' });
    const okButton = el('button', { type: 'button', class: 'button button--primary', id: 'pick-confirm' }, confirmLabel);
    const cancelButton = el('button', { type: 'button', class: 'button button--quiet' }, 'Vazgeç');
    const fold = (text) => String(text ?? '').toLocaleLowerCase('tr-TR');

    const updateButton = () => {
      okButton.textContent = selected.size ? `${confirmLabel} (${selected.size})` : confirmLabel;
    };
    const render = () => {
      const query = fold(search?.value ?? '').trim();
      const shown = items.filter((item) => !query || fold(`${item.label} ${item.sublabel ?? ''}`).includes(query));
      list.replaceChildren(
        ...(shown.length
          ? shown.map((item) => {
              const box = el('input', { type: 'checkbox', class: 'pick-list__box', id: `pick-${item.id}`, checked: item.disabled || selected.has(item.id), disabled: item.disabled });
              box.addEventListener('change', () => {
                if (box.checked) selected.add(item.id);
                else selected.delete(item.id);
                updateButton();
              });
              return el(
                'li',
                { class: 'pick-list__item' },
                el('label', { class: 'pick-list__label', for: `pick-${item.id}` },
                  box,
                  el('span', { class: 'pick-list__text' },
                    el('span', { class: 'pick-list__title', text: item.label }),
                    item.sublabel ? el('span', { class: 'pick-list__sub', text: item.sublabel }) : null))
              );
            })
          : [el('li', { class: 'pick-list__empty', text: query ? 'Aramaya uyan yok.' : emptyText })])
      );
    };
    search?.addEventListener('input', render);
    render();
    updateButton();

    let done = false;
    const finish = (answer) => {
      if (done) return;
      done = true;
      close();
      resolve(answer);
    };
    const close = openDialog({
      className: 'dialog--pick',
      labelledBy: 'pick-title',
      children: [
        el('h2', { class: 'dialog__title', id: 'pick-title', text: title }),
        search,
        list,
        footer,
        el('div', { class: 'dialog__actions' }, cancelButton, okButton),
      ],
      onCancel: () => finish(null),
    });
    cancelButton.addEventListener('click', () => finish(null));
    okButton.addEventListener('click', () => finish([...selected]));
    (search ?? okButton).focus({ preventScroll: true });
  });
}
