// aktar.js dosyasını js/music/bookmarklet.js içindeki IMPORT_SCRIPT'ten üretir.
// Kullanım (proje klasöründe): node tools/build-aktar.mjs
import { writeFileSync } from 'node:fs';
import { IMPORT_SCRIPT } from '../js/music/bookmarklet.js';

writeFileSync(new URL('../aktar.js', import.meta.url), `${IMPORT_SCRIPT}\n`);
console.log('aktar.js yazıldı.');
