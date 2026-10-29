/**
 * Durum ekranı: uygulama çalışıyor mu, internetsiz kullanıma hazır mı,
 * internet bağlantısı var mı, kaç şarkı kayıtlı, veriler kalıcı mı,
 * ne kadar alan kullanılıyor ve hangi sürüm çalışıyor.
 */
import { formatBytes } from '../lib/text.js';

const OFFLINE_STATES = {
  pending: { text: 'Hazırlanıyor…', tone: 'neutral' },
  ready: { text: 'Hazır', tone: 'ok' },
  failed: { text: 'Hazırlanamadı', tone: 'danger' },
  unsupported: { text: 'Desteklenmiyor', tone: 'danger' },
};

// Tarayıcı, kalıcı depolama iznini kullanım sıklığına göre kendisi verir;
// "Henüz verilmedi" bir hata değildir, uygulama kullanıldıkça değişebilir.
const PERSISTENCE_STATES = {
  pending: { text: 'Kontrol ediliyor…', tone: 'neutral' },
  granted: { text: 'Açık', tone: 'ok' },
  denied: { text: 'Henüz verilmedi', tone: 'neutral' },
  unsupported: { text: 'Desteklenmiyor', tone: 'neutral' },
};

/** Bir durum değerinin yazısını ve rengini ayarlar. tone: 'ok' | 'neutral' | 'danger' */
function setState(element, text, tone) {
  element.textContent = text;
  element.dataset.tone = tone;
}

export function describeOffline(offline) {
  return OFFLINE_STATES[offline] ?? OFFLINE_STATES.pending;
}

export function createStatusView(root) {
  const ui = {
    app: root.querySelector('#state-app'),
    offline: root.querySelector('#state-offline'),
    network: root.querySelector('#state-network'),
    songs: root.querySelector('#state-songs'),
    persistence: root.querySelector('#state-persistence'),
    storage: root.querySelector('#state-storage'),
    version: root.querySelector('#state-version'),
  };

  return {
    update(status) {
      if (status.appError) setState(ui.app, 'Hata oluştu', 'danger');
      else setState(ui.app, 'Çalışıyor', 'ok');

      const offline = describeOffline(status.offline);
      setState(ui.offline, offline.text, offline.tone);
      setState(ui.network, status.online ? 'Var' : 'Yok', status.online ? 'ok' : 'neutral');

      ui.songs.textContent = Number.isFinite(status.songCount) ? String(status.songCount) : '—';

      const persistence = PERSISTENCE_STATES[status.persistence] ?? PERSISTENCE_STATES.pending;
      setState(ui.persistence, persistence.text, persistence.tone);

      ui.storage.textContent = status.storage
        ? `${formatBytes(status.storage.usage)} / ${formatBytes(status.storage.quota)}`
        : '—';
      ui.version.textContent = status.version ?? '—';
    },
  };
}
