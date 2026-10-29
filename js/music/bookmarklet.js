/**
 * "Repertuvarım'a aktar" yer imi.
 *
 * Tarayıcılar, bir sitenin başka bir sitedeki sayfayı okumasına izin vermez; bu
 * yüzden uygulama repertuarim.com ya da akorlar.com sayfasını bağlantıdan açıp
 * okuyamaz. Yer imi ise o sitenin sayfasının içinde çalışır:
 *  1. Şarkının akor kutusunu (pre#key.chords), başlığını ve orijinal tonunu bulur,
 *  2. bunları "Repertuvarım aktarım" biçiminde panoya kopyalar
 *     (kopyalanamazsa ekranda bir "Kopyala" düğmesi gösterir),
 *  3. kullanıcı uygulamada "Panodan aktar"a dokunur (bkz. song-text.js parseImport).
 * Hiçbir veri bir sunucuya gönderilmez.
 *
 * Kurallar: kod tek satırdır (yer imi adresine yapıştırılabilsin diye), // yorumu
 * ve yüzde işareti içermez. Testi: tests/bookmarklet (tarayıcıda) ve aşama 8 testleri.
 */

const SOURCE = [
  "(()=>{",
  "const old=document.getElementById('rp-aktar');if(old)old.remove();",
  "const p=document.querySelector('pre#key.chords,pre.chords');",
  "if(!p){alert('Bu sayfada akor bulunamadı. Bir şarkının akor sayfasını açıp tekrar deneyin.');return}",
  "const h=document.querySelector('h1');",
  "const t=((h&&h.innerText)||document.title).replace(/\\s+/g,' ').replace(/\\s*-?\\s*Akor\\b.*$/i,'').trim();",
  "let a='',s=t;const i=t.indexOf(' - ');if(i>0){a=t.slice(0,i).trim();s=t.slice(i+3).trim()}",
  "const m=document.body.innerText.match(/Ori?jinal Ton\\s*:\\s*([A-G][#b]?m?)/i);",
  "const x=['Repertuvarım aktarım','Şarkı: '+s,'Sanatçı: '+a,'Ton: '+(m?m[1]:''),'Kaynak: '+location.href,'',p.innerText.replace(/\\u00a0/g,' ')].join('\\n');",
  "const d=document.createElement('div');d.id='rp-aktar';",
  "d.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-width:480px;margin:0 auto;background:#231d2e;color:#f3eee6;border:1px solid #ffd43b;border-radius:16px;padding:16px;font:16px/1.45 system-ui,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.5);text-align:left';",
  "const b=document.createElement('b');b.textContent='Repertuvarım’a aktar';b.style.cssText='display:block;margin-bottom:6px;color:#ffd43b';",
  "const msg=document.createElement('div');msg.textContent='“'+s+'” panoya kopyalanacak.';",
  "const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;justify-content:flex-end;margin-top:12px';",
  "const btn=(label,main)=>{const e=document.createElement('button');e.type='button';e.textContent=label;e.style.cssText='font:inherit;font-weight:700;min-height:44px;padding:0 16px;border-radius:12px;cursor:pointer;'+(main?'background:#ffd43b;color:#2a1a00;border:0':'background:transparent;color:#f3eee6;border:1px solid #3a3149');return e};",
  "const close=btn('Kapat',false),copy=btn('Kopyala',true);close.onclick=()=>d.remove();",
  "const done=()=>{msg.textContent='“'+s+'” kopyalandı. Şimdi Repertuvarım’ı açın: Şarkı ekle → Panodan aktar.';copy.remove();close.textContent='Tamam'};",
  "const fallback=()=>{const ta=document.createElement('textarea');ta.value=x;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:0;left:0;opacity:0';document.body.appendChild(ta);ta.select();ta.setSelectionRange(0,x.length);let ok=false;try{ok=document.execCommand('copy')}catch(e){}ta.remove();if(ok)done();else msg.textContent='Kopyalanamadı. Kopyala düğmesine tekrar dokunun.'};",
  "const tryCopy=(quiet)=>{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(x).then(done,()=>{if(!quiet)fallback()})}else if(!quiet)fallback()};",
  "copy.onclick=()=>tryCopy(false);",
  "row.append(close,copy);d.append(b,msg,row);document.body.appendChild(d);",
  "tryCopy(true)",
  "})()",
].join('');

/** Yer imine yapıştırılacak adres. */
export const BOOKMARKLET = `javascript:${SOURCE}`;
