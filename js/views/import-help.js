/**
 * "Sitelerden aktarma" ekranı (#/aktar):
 * repertuarim.com ve akorlar.com için "Repertuvarım'a aktar" yer iminin kurulumu ve kullanımı.
 */
import { el } from '../lib/dom.js';
import { BOOKMARKLET } from '../music/bookmarklet.js';
import { showMessage } from './components.js';

export function renderImportHelp(root) {
  const copyButton = el('button', { type: 'button', class: 'button button--primary', id: 'copy-bookmarklet' }, 'Yer imi kodunu kopyala');
  copyButton.addEventListener('click', () => copyText(BOOKMARKLET));

  // Bilgisayarda yer imleri çubuğuna sürüklenecek bağlantı. Uygulamanın içinde tıklanırsa
  // çalışmaz (aktarılacak akor sayfası burada yok); yalnızca sürüklenir.
  const dragLink = el('a', { class: 'bookmarklet-link', id: 'bookmarklet-link', href: BOOKMARKLET, draggable: 'true' }, 'Repertuvarım’a aktar');
  dragLink.addEventListener('click', (event) => {
    event.preventDefault();
    showMessage('Bu düğmeyi tıklamayın; fareyle yer imleri çubuğuna sürükleyin.');
  });

  const steps = (items) => el('ol', { class: 'help-steps' }, items.map((item) => el('li', {}, item)));

  root.replaceChildren(
    el(
      'article',
      { class: 'page page--screen help' },
      el('h1', { class: 'screen-title', tabindex: '-1', text: 'Sitelerden aktarma' }),
      el('p', { class: 'help__lead', text: 'repertuarim.com ve akorlar.com’daki bir şarkıyı; adı, sanatçısı, orijinal tonu ve akorlarıyla tek dokunuşla aktarabilirsiniz.' }),

      el('section', { class: 'help__section' },
        el('h2', { class: 'section-title', text: 'Nasıl çalışır?' }),
        steps([
          'Sitede şarkının akor sayfasını açın.',
          'Tarayıcınızın yer imlerinden “Repertuvarım’a aktar”a dokunun. Şarkı panoya kopyalanır.',
          'Repertuvarım’da “Şarkı ekle” → “Panodan aktar”a dokunun ve kaydedin.',
        ]),
        el('p', { class: 'field__hint', text: 'Bunun için yer imini tarayıcınıza bir kez eklemeniz gerekiyor (aşağıda). Tarayıcılar bir sitenin başka bir sitedeki sayfayı okumasına izin vermediği için bağlantıyı yapıştırarak aktarmak mümkün değil; yer imi sayfanın içinde çalıştığı için bu engel yok. Şarkılar hiçbir sunucuya gönderilmez.' })
      ),

      el('section', { class: 'help__section' },
        el('h2', { class: 'section-title', text: 'iPhone’da kurulum (Safari)' }),
        steps([
          el('span', {}, 'Bu düğmeye dokunun: ', copyButton),
          'Safari’de herhangi bir sayfadayken ••• → Paylaş → “Yer İşareti Ekle”ye dokunun ve kaydedin.',
          'Yer işaretlerini açın (kitap simgesi), “Düzenle”ye dokunun ve az önce eklediğiniz yer işaretini seçin.',
          'Adını “Repertuvarım’a aktar” yapın. Adres kutusundakini silip kopyaladığınız kodu yapıştırın ve “Bitti”ye dokunun.',
        ]),
        el('p', { class: 'field__hint', text: 'Kullanırken: sitede şarkıyı açın, adres çubuğuna dokunup yer işaretleri arasından “Repertuvarım’a aktar”ı seçin.' })
      ),

      el('section', { class: 'help__section' },
        el('h2', { class: 'section-title', text: 'Bilgisayarda kurulum (Chrome, Edge)' }),
        steps([
          'Yer imleri çubuğu görünmüyorsa Ctrl + Shift + B tuşlarına basın.',
          el('span', {}, 'Bu düğmeyi fareyle yer imleri çubuğuna sürükleyip bırakın: ', dragLink),
        ]),
        el('p', { class: 'field__hint', text: 'Kullanırken: sitede şarkıyı açın ve yer imleri çubuğundaki “Repertuvarım’a aktar”a tıklayın.' })
      ),

      el('section', { class: 'help__section' },
        el('h2', { class: 'section-title', text: 'Android’de kurulum (Chrome)' }),
        steps([
          el('span', {}, 'Kodu kopyalayın (yukarıdaki iPhone bölümündeki düğme).'),
          'Herhangi bir sayfayı yer imlerine ekleyin (⋮ → ☆), sonra yer imini düzenleyip adını “Repertuvarım’a aktar”, adresini kopyaladığınız kod yapın.',
          'Kullanırken: sitede şarkıyı açın, adres çubuğuna “Repertuvarım” yazın ve önerilerdeki yer imine dokunun.',
        ])
      ),

      el('section', { class: 'help__section' },
        el('h2', { class: 'section-title', text: 'Yer imi olmadan' }),
        el('p', {}, 'Sitede akorları ve sözleri seçip kopyalayın, “Şarkı ekle” formundaki “Söz ve akorlar” kutusuna yapıştırın ve “Akorları yerleştir”e dokunun. Şarkı adını ve sanatçıyı kendiniz yazarsınız.')
      ),

      el('a', { class: 'button button--quiet', href: '#/yeni' }, 'Şarkı eklemeye git')
    )
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showMessage('Kod kopyalandı. Şimdi yer imine yapıştırın.');
    return;
  } catch {
    // Eski yöntemle dene.
  }
  const area = el('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });
  area.value = text;
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  showMessage(ok ? 'Kod kopyalandı. Şimdi yer imine yapıştırın.' : 'Kopyalanamadı. Lütfen tekrar deneyin.', { tone: ok ? 'info' : 'error' });
}
