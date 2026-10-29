/**
 * Durum ekranı: uygulama çalışıyor mu, internetsiz kullanıma hazır mı,
 * internet bağlantısı var mı, hangi sürüm kullanılıyor.
 */

const OFFLINE_STATES = {
  pending: { text: 'Hazırlanıyor…', tone: 'neutral' },
  ready: { text: 'Hazır', tone: 'ok' },
  failed: { text: 'Hazırlanamadı', tone: 'danger' },
  unsupported: { text: 'Bu tarayıcıda desteklenmiyor', tone: 'danger' },
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
    version: root.querySelector('#state-version'),
  };

  return {
    update(status) {
      if (status.appError) setState(ui.app, 'Hata oluştu', 'danger');
      else setState(ui.app, 'Çalışıyor', 'ok');

      const offline = describeOffline(status.offline);
      setState(ui.offline, offline.text, offline.tone);
      setState(ui.network, status.online ? 'Var' : 'Yok', status.online ? 'ok' : 'neutral');
      ui.version.textContent = status.version ?? '—';
    },
  };
}
