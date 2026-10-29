/**
 * Küçük arayüz yardımcıları.
 * Kullanıcının yazdığı metinler her zaman düz metin olarak eklenir (HTML olarak
 * yorumlanmaz); böylece şarkı adındaki özel karakterler sayfayı bozamaz.
 */

/**
 * Yeni bir HTML öğesi oluşturur.
 * el('a', { class: 'link', href: '#/' }, 'Metin', başkaÖğe)
 * Özel anahtarlar: class, text, dataset, on<Olay> (ör. onclick).
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

// Simgeler: uygulamaya özel, basit çizgiler (24×24).
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.1"/>',
  star: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" fill="currentColor" stroke="none"/>',
  starOutline: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
};

/** Ekran okuyucuların atladığı bir simge öğesi döndürür. */
export function icon(name, className = 'icon') {
  const wrapper = document.createElement('span');
  wrapper.className = className;
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    `stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return wrapper;
}

/** Yalnızca ekran okuyucuların duyacağı metin. */
export function srOnly(text) {
  return el('span', { class: 'visually-hidden', text });
}
