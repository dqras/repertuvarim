/**
 * Fotoğraftan nota okuma (OMR).
 *
 * Okumayı LEGATO yapar: basılı notaları okuyan açık bir yapay zekâ modeli (ICLR 2026).
 * Hugging Face'teki ücretsiz örnek sunucusuna (guangyangmusic/legato-demo) fotoğraf
 * gönderilir, sonuç ABC nota yazısı olarak gelir ve abc.js ile uygulamanın notalarına
 * çevrilir. İnternet gerekir; fotoğraf okunmak için bu sunucuya gönderilir.
 *
 * Sunucu bir süre kullanılmazsa uykuya geçer; ilk istekte uyanması bir-iki dakika sürebilir.
 */
import { parseAbc } from './abc.js';

export const OMR_SERVER = 'https://guangyangmusic-legato-demo.hf.space';
const MAX_SIDE = 2200; // gönderilmeden önce fotoğraf en fazla bu boyuta küçültülür
const WAIT_LIMIT_MS = 4 * 60 * 1000;

export class OmrError extends Error {
  constructor(reason, message) {
    super(message ?? reason);
    this.reason = reason; // 'offline' | 'server' | 'busy' | 'image' | 'empty' | 'timeout'
  }
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

/** Bir sunucu-gönderimli-olay akışından sonucu okur ("event: complete / data: [...]"). */
function readEvents(text) {
  const events = [];
  for (const block of text.split(/\n\n+/)) {
    const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
    const data = /^data:\s*(.*)$/m.exec(block)?.[1];
    if (event) events.push({ event, data });
  }
  return events;
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
  const uploaded = await (await request(`${OMR_SERVER}/gradio_api/upload`, { method: 'POST', body: form }, waking)).json();
  const path = uploaded?.[0];
  if (!path) throw new OmrError('server', 'upload');

  onProgress?.({ step: 'reading' });
  const start = await (await request(`${OMR_SERVER}/gradio_api/call/run_legato`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [{ path, meta: { _type: 'gradio.FileData' } }] }),
  }, waking)).json();
  if (!start?.event_id) throw new OmrError('server', 'no event');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WAIT_LIMIT_MS);
  let text;
  try {
    text = await (await fetch(`${OMR_SERVER}/gradio_api/call/run_legato/${start.event_id}`, { signal: controller.signal })).text();
  } catch {
    throw new OmrError(controller.signal.aborted ? 'timeout' : 'server');
  } finally {
    clearTimeout(timer);
  }
  const events = readEvents(text);
  const done = events.find((e) => e.event === 'complete');
  if (!done) {
    const failed = events.find((e) => e.event === 'error');
    throw new OmrError(failed && /queue|busy|quota/i.test(failed.data ?? '') ? 'busy' : 'server', failed?.data ?? 'no result');
  }
  let abc = '';
  try {
    abc = JSON.parse(done.data)?.[0] ?? '';
  } catch {
    abc = '';
  }
  const result = parseAbc(abc);
  if (!result.measures.length) throw new OmrError('empty');
  return { ...result, abc };
}

/**
 * Birden fazla fotoğrafı sırayla okuyup tek beste yapar (sayfa sayfa).
 * Ton, ölçü, anahtar ve ad ilk fotoğraftan alınır. Okunamayan sayfa varsa failed'de döner.
 */
export async function readScorePhotos(files, { onProgress } = {}) {
  let combined = null;
  const failed = [];
  for (const [index, file] of files.entries()) {
    try {
      const page = await readScorePhoto(file, { onProgress: (p) => onProgress?.({ ...p, page: index + 1, pages: files.length }) });
      if (!combined) combined = { ...page, warnings: [...page.warnings] };
      else {
        combined.measures = combined.measures.concat(page.measures);
        combined.warnings.push(...page.warnings);
        if (page.fifths !== combined.fifths) combined.warnings.push('key-change');
      }
    } catch (error) {
      if (!combined && index === files.length - 1) throw error;
      if (error instanceof OmrError && error.reason === 'offline') throw error;
      failed.push({ page: index + 1, error });
    }
  }
  if (!combined) throw failed[0]?.error ?? new OmrError('empty');
  return { ...combined, failed };
}
