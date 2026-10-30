/**
 * Fotoğraftan nota okuma (OMR). İki okuyucu var:
 *
 * 1) Telefondaki okuyucu (varsayılan): omr-local.js. İnternet gerekmez, fotoğraf cihazdan
 *    çıkmaz. Basılı, net notalarda iyi sonuç verir. Okuma ayrı bir iş parçacığında yapılır
 *    (omr-worker.js), ekran donmaz.
 *
 * 2) Gelişmiş okuyucu: LEGATO, basılı notaları okuyan açık bir yapay zekâ modeli (ICLR 2026).
 *    Hugging Face'teki ücretsiz örnek sunucusuna (guangyangmusic/legato-demo) fotoğraf
 *    gönderilir, sonuç ABC nota yazısı olarak gelir ve abc.js ile notalara çevrilir.
 *    İnternet gerekir; günlük ücretsiz kullanım hakkı vardır (anahtarsız birkaç okuma); hak
 *    dolunca sebebi 'quota' hatasıyla bildirilir. İsteğe bağlı ücretsiz anahtar hakkı artırır.
 *    Sunucu bir süre kullanılmazsa uykuya geçer; ilk istekte uyanması bir-iki dakika sürebilir.
 */
import { parseAbc } from './abc.js';
import { readScoreBitmap } from './omr-local.js';

export const OMR_SERVER = 'https://guangyangmusic-legato-demo.hf.space';
const MAX_SIDE = 2200; // gönderilmeden önce fotoğraf en fazla bu boyuta küçültülür
const WAIT_LIMIT_MS = 4 * 60 * 1000;

export class OmrError extends Error {
  constructor(reason, message, extra = {}) {
    super(message ?? reason);
    // 'offline' | 'server' | 'busy' | 'quota' | 'token' | 'image' | 'empty' | 'timeout'
    this.reason = reason; // ayrıca 'pdf': telefondaki okuyucu PDF açamaz
    Object.assign(this, extra); // quota: { retrySeconds, withToken }
  }
}

/*
 * İsteğe bağlı Hugging Face anahtarı (token). Okuyucu, anahtarsız kullanımda günde yalnızca
 * birkaç okumaya izin verir; ücretsiz bir Hugging Face hesabının anahtarıyla bu hak artar.
 * Anahtar yalnızca bu cihazda saklanır ve yalnızca okuyucuya gönderilir; yedeğe girmez.
 */
const TOKEN_KEY = 'repertuvarim:hfToken';
export function getReaderToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}
export function setReaderToken(token) {
  const value = String(token ?? '').trim();
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* saklanamazsa anahtarsız devam edilir */
  }
  return value;
}
/** Anahtar biçimi doğru mu? (hf_ ile başlar, boşluk içermez) */
export const looksLikeToken = (token) => /^hf_[A-Za-z0-9]{20,}$/.test(String(token ?? '').trim());

function authHeaders(extra = {}) {
  const token = getReaderToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/** "Try again in 1:23:45" → saniye; yoksa null. */
function retrySeconds(message) {
  const m = /try again in (\d+):(\d{2}):(\d{2})/i.exec(message ?? '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Okuyucunun hata yazısını uygulamanın hata türüne çevirir. */
export function errorFromMessage(message) {
  const text = String(message ?? '');
  if (/quota/i.test(text)) {
    return new OmrError('quota', text, { retrySeconds: retrySeconds(text), withToken: Boolean(getReaderToken()) });
  }
  if (/token|unauthori[sz]ed|401/i.test(text)) return new OmrError('token', text);
  if (/queue|busy|too many/i.test(text)) return new OmrError('busy', text);
  return new OmrError('server', text || 'no result');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fotoğrafı JPEG olarak küçültür (yükleme hızlansın). PDF'ler olduğu gibi gönderilir. */
async function prepare(file) {
  if (file.type === 'application/pdf') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new OmrError('image');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new OmrError('image'))), 'image/jpeg', 0.9)
  );
}

async function request(url, options, onWaking) {
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    if (navigator.onLine === false) throw new OmrError('offline');
    let response;
    try {
      response = await fetch(url, options);
    } catch {
      if (navigator.onLine === false) throw new OmrError('offline');
      response = null;
    }
    if (response?.ok) return response;
    // Uyuyan sunucu uyanırken 502/503 döner; bir süre bekleyip tekrar dene.
    if (Date.now() - started > WAIT_LIMIT_MS) throw new OmrError(response ? 'server' : 'offline');
    if (response && [401, 403].includes(response.status) && getReaderToken()) throw new OmrError('token', `HTTP ${response.status}`);
    if (response && ![404, 429, 500, 502, 503, 504].includes(response.status)) throw new OmrError('server', `HTTP ${response.status}`);
    if (response?.status === 429) throw new OmrError('busy');
    onWaking?.();
    // Beklerken bağlantı koparsa hemen bırak.
    for (let waited = 0; waited < Math.min(15000, 3000 + attempt * 2000); waited += 500) {
      if (navigator.onLine === false) throw new OmrError('offline');
      await sleep(500);
    }
  }
}

/**
 * Kuyruk akışını okur ("data: {msg: …}" satırları) ve sonucu bekler.
 * Sonuç gelince { success, output } döner.
 */
async function readQueue(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const line = block.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (message.msg === 'process_completed') return message;
        if (message.msg === 'unexpected_error') return { success: false, output: { error: message.message } };
        if (message.msg === 'close_stream') return null;
      }
      if (done || signal.aborted) return null;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Okuma işlevinin sıra numarası (sunucu güncellenirse değişebilir; bulunamazsa 2). */
let readerIndex = null;
async function findReaderIndex() {
  if (readerIndex !== null) return readerIndex;
  try {
    const config = await (await fetch(`${OMR_SERVER}/config`, { headers: authHeaders() })).json();
    const found = config.dependencies?.find((d) => d.api_name === 'run_legato');
    if (found) readerIndex = Number.isInteger(found.id) ? found.id : config.dependencies.indexOf(found);
  } catch {
    /* sunucu uyanıyor olabilir; varsayılanla devam */
  }
  return readerIndex ?? 2;
}

/**
 * Bir fotoğrafı okur. Sonuç: abc.js parseAbc biçimi + { abc }.
 * onProgress({ step: 'upload' | 'waking' | 'reading' })
 */
export async function readScorePhoto(file, { onProgress } = {}) {
  if (navigator.onLine === false) throw new OmrError('offline');
  const blob = await prepare(file);
  onProgress?.({ step: 'upload' });
  const waking = () => onProgress?.({ step: 'waking' });

  const form = new FormData();
  form.append('files', blob, file.type === 'application/pdf' ? 'nota.pdf' : 'nota.jpg');
  const uploaded = await (await request(`${OMR_SERVER}/gradio_api/upload`, { method: 'POST', headers: authHeaders(), body: form }, waking)).json();
  const path = uploaded?.[0];
  if (!path) throw new OmrError('server', 'upload');

  onProgress?.({ step: 'reading' });
  // Kuyruğa katıl: hata olursa (ör. günlük hak dolduysa) okuyucu sebebini burada söyler.
  const session = Math.random().toString(36).slice(2, 13);
  const fnIndex = await findReaderIndex();
  const joined = await (await request(`${OMR_SERVER}/gradio_api/queue/join`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ data: [{ path, meta: { _type: 'gradio.FileData' } }], event_data: null, fn_index: fnIndex, trigger_id: null, session_hash: session }),
  }, waking)).json();
  if (!joined?.event_id) throw new OmrError('server', 'no event');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WAIT_LIMIT_MS);
  let finished;
  try {
    const stream = await fetch(`${OMR_SERVER}/gradio_api/queue/data?session_hash=${session}`, { headers: authHeaders(), signal: controller.signal });
    if (!stream.ok) throw new OmrError('server', `HTTP ${stream.status}`);
    finished = await readQueue(stream, controller.signal);
  } catch (error) {
    if (error instanceof OmrError) throw error;
    if (navigator.onLine === false) throw new OmrError('offline');
    throw new OmrError(controller.signal.aborted ? 'timeout' : 'server');
  } finally {
    clearTimeout(timer);
  }
  if (!finished) throw new OmrError(controller.signal.aborted ? 'timeout' : 'server', 'no result');
  if (!finished.success) throw errorFromMessage(finished.output?.error ?? finished.title);

  const abc = finished.output?.data?.[0];
  const result = parseAbc(typeof abc === 'string' ? abc : '');
  if (!result.measures.length) throw new OmrError('empty');
  return { ...result, abc };
}

// --- Telefondaki okuyucu ---------------------------------------------------------------

const LOCAL_MAX_SIDE = 3200; // çok büyük fotoğraflar önce küçültülür (hız ve bellek)

/** Fotoğrafı gri tonlu piksellere çevirir: { width, height, data } */
async function toGray(file) {
  if (file.type === 'application/pdf') throw new OmrError('pdf');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new OmrError('image');
  }
  const scale = Math.min(1, LOCAL_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const rgba = context.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 1, j += 4) {
    data[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  }
  return { width, height, data };
}

/** Okumayı arka plan işçisinde yapar; işçi açılamazsa (eski tarayıcı) doğrudan yapar. */
function runLocal(image) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./omr-worker.js', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
    if (!worker) {
      try {
        resolve(readScoreBitmap(image));
      } catch (error) {
        reject(error);
      }
      return;
    }
    let settled = false;
    const fallback = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      try {
        resolve(readScoreBitmap(image));
      } catch (error) {
        reject(error);
      }
    };
    worker.onmessage = (event) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      fallback(); // modül işçisi desteklenmiyorsa
    };
    worker.postMessage(image);
  });
}

/** Bir fotoğrafı telefonda okur. Sonuç: abc.js parseAbc biçimi. */
export async function readScorePhotoLocal(file, { onProgress } = {}) {
  onProgress?.({ step: 'local' });
  const image = await toGray(file);
  let result;
  try {
    result = await runLocal(image);
  } catch (error) {
    console.error('Nota okunamadı:', error);
    throw new OmrError('empty');
  }
  if (!result.measures.length) throw new OmrError('empty');
  return result;
}

/**
 * Birden fazla fotoğrafı sırayla okuyup tek beste yapar (sayfa sayfa).
 * Ton, ölçü, anahtar ve ad ilk fotoğraftan alınır. Okunamayan sayfa varsa failed'de döner.
 * engine: 'local' (telefondaki okuyucu, varsayılan) ya da 'advanced' (LEGATO, internet gerekir)
 */
export async function readScorePhotos(files, { onProgress, engine = 'local' } = {}) {
  const readOne = engine === 'advanced' ? readScorePhoto : readScorePhotoLocal;
  let combined = null;
  const failed = [];
  for (const [index, file] of files.entries()) {
    try {
      const page = await readOne(file, { onProgress: (p) => onProgress?.({ ...p, page: index + 1, pages: files.length }) });
      if (!combined) combined = { ...page, warnings: [...page.warnings] };
      else {
        combined.measures = combined.measures.concat(page.measures);
        combined.warnings.push(...page.warnings);
        if (page.fifths !== combined.fifths) combined.warnings.push('key-change');
      }
    } catch (error) {
      if (!combined && index === files.length - 1) throw error;
      if (error instanceof OmrError && ['offline', 'quota', 'token'].includes(error.reason)) throw error;
      failed.push({ page: index + 1, error });
    }
  }
  if (!combined) throw failed[0]?.error ?? new OmrError('empty');
  return { ...combined, failed };
}
