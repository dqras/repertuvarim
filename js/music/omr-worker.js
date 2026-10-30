/**
 * Nota okuyucunun arka plan işçisi: okuma birkaç saniye sürebildiği için ekran donmasın diye
 * ayrı bir iş parçacığında çalışır. Gri görüntüyü alır, okunan notaları döndürür.
 */
import { readScoreBitmap } from './omr-local.js';

self.onmessage = (event) => {
  try {
    const result = readScoreBitmap(event.data);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, message: String(error?.message ?? error) });
  }
};
