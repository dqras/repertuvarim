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
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  minus: '<path d="M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8.5"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.1M4.5 12h.1M4.5 18h.1" stroke-width="2.6"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M5 19.5h14"/>',
  upload: '<path d="M12 16V5M7 9.5l5-5 5 5"/><path d="M5 19.5h14"/>',
  shield: '<path d="M12 3.5l7 2.6v5.6c0 4.3-3 7.6-7 8.8-4-1.2-7-4.5-7-8.8V6.1z"/><path d="M9 12l2 2 4-4"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z"/><circle cx="8" cy="8" r="1.4"/>',
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
