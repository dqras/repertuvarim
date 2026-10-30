/**
 * Ekran görüntüsündeki yazıyı okur (OCR) ve akor sayfasına çevirir.
 *
 * Okuma için açık kaynaklı Tesseract (tesseract.js) kullanılır. Uygulamaya gömülü
 * değildir (yaklaşık 6 MB); ilk kullanımda jsDelivr'dan bir kez indirilir ve telefonda
 * saklanır: sonraki kullanımlarda internet gerekmez. Görüntü telefonda işlenir, hiçbir
 * sunucuya gönderilmez.
 *
 * Akış: görüntü → (koyu zeminse renkleri ters çevir) → Tesseract → harf kutuları →
 * ocr-sheet.js sheetFromOcr → akor satırları ayrı düz metin.
 */
import { sheetFromOcr } from './ocr-sheet.js';

const CDN = 'https://cdn.jsdelivr.net/npm/';
export const OCR_FILES = {
  library: `${CDN}tesseract.js@6.0.1/dist/tesseract.min.js`,
  worker: `${CDN}tesseract.js@6.0.1/dist/worker.min.js`,
  coreSimd: `${CDN}tesseract.js-core@6.0.0/tesseract-core-simd-lstm.wasm.js`,
  core: `${CDN}tesseract.js-core@6.0.0/tesseract-core-lstm.wasm.js`,
  // Türkçe dil verisi (Tesseract, dosyayı kendisi indirip kendi deposunda saklar)
  languages: `${CDN}@tesseract.js-data/tur@1.0.0/4.0.0_best_int`,
};

// Uygulamanın sürüm önbelleğinden ayrı: uygulama güncellense de silinmez.
const CACHE_NAME = 'rv-ocr-6.0.1';

export class OcrError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason; // 'offline' | 'download' | 'image' | 'empty' | 'engine'
  }
}

/** WebAssembly SIMD destekleniyor mu? (Daha hızlı çekirdek için) */
function supportsSimd() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

/** Dosyayı önce telefondaki depodan, yoksa internetten getirir (ve saklar). */
async function cachedBlob(url) {
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return hit.blob();
  } catch {
    cache = null; // depo kullanılamıyorsa doğrudan indir
  }
  let response;
  try {
    response = await fetch(url, { mode: 'cors' });
  } catch {
    throw new OcrError(navigator.onLine === false ? 'offline' : 'download', 'download failed');
  }
  if (!response.ok) throw new OcrError('download', `HTTP ${response.status}`);
  try {
    await cache?.put(url, response.clone());
  } catch {
    // Saklanamadı (yer yok vb.): bu sefer yine de çalışsın.
  }
  return response.blob();
}

/** Okuma için gereken dosyalar telefonda hazır mı? (İnternetsiz kullanım bilgisi için) */
export async function isOcrReady() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const core = supportsSimd() ? OCR_FILES.coreSimd : OCR_FILES.core;
    const hits = await Promise.all([OCR_FILES.library, OCR_FILES.worker, core].map((url) => cache.match(url)));
    return hits.every(Boolean) && localStorage.getItem('repertuvarim.ocrDil') === 'tur';
  } catch {
    return false;
  }
}

let loading = null;
async function loadEngine(onProgress) {
  if (window.Tesseract && loading) return loading;
  loading = (async () => {
    onProgress?.({ step: 'download', progress: 0 });
    const core = supportsSimd() ? OCR_FILES.coreSimd : OCR_FILES.core;
    const [library, worker, coreBlob] = await Promise.all([
      cachedBlob(OCR_FILES.library),
      cachedBlob(OCR_FILES.worker),
      cachedBlob(core),
    ]);
    if (!window.Tesseract) {
      const url = URL.createObjectURL(library);
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new OcrError('engine', 'library failed'));
        document.head.append(script);
      });
    }
    // Tesseract, çekirdek adresinin ".js" ile bitmesini bekler; adresin sonuna #.js eklenir.
    return { workerPath: URL.createObjectURL(worker), corePath: `${URL.createObjectURL(coreBlob)}#core.js` };
  })();
  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

/** Görüntüyü okumaya hazırlar: gri tona çevirir, koyu zeminliyse renkleri ters çevirir. */
async function prepareImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new OcrError('image', 'not an image');
  }
  // Çok büyük görüntüleri küçült (telefon belleği), küçükleri büyüt (okunabilirlik).
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > 4000 ? 4000 / longest : bitmap.width < 700 ? 2 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    pixels[i] = pixels[i + 1] = pixels[i + 2] = gray;
    total += gray;
  }
  if (total / (pixels.length / 4) < 128) {
    for (let i = 0; i < pixels.length; i += 4) pixels[i] = pixels[i + 1] = pixels[i + 2] = 255 - pixels[i];
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Ekran görüntüsünü okuyup akor sayfası metnine çevirir.
 * onProgress({ step: 'download' | 'language' | 'reading', progress: 0..1 })
 * Sonuç: { text, chordLines, lyricLines }
 */
export async function readChordScreenshot(file, { onProgress } = {}) {
  const canvas = await prepareImage(file);
  const paths = await loadEngine(onProgress);
  let worker;
  try {
    worker = await window.Tesseract.createWorker('tur', 1, {
      ...paths,
      workerBlobURL: false,
      langPath: OCR_FILES.languages,
      gzip: true,
      logger: (message) => {
        if (/language|traineddata/i.test(message.status)) onProgress?.({ step: 'language', progress: message.progress ?? 0 });
        else if (/recogniz/i.test(message.status)) onProgress?.({ step: 'reading', progress: message.progress ?? 0 });
      },
      errorHandler: () => {},
    });
  } catch (error) {
    throw new OcrError(navigator.onLine === false ? 'offline' : 'engine', String(error?.message ?? error));
  }
  try {
    try {
      localStorage.setItem('repertuvarim.ocrDil', 'tur');
    } catch {
      // önemli değil
    }
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
    const sheet = sheetFromOcr(data);
    if (!sheet.text.trim()) throw new OcrError('empty', 'no text');
    return sheet;
  } catch (error) {
    if (error instanceof OcrError) throw error;
    throw new OcrError('engine', String(error?.message ?? error));
  } finally {
    worker.terminate().catch(() => {});
  }
}
