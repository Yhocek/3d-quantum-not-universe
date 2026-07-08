/* Sabitler + saf yardımcılar (Three.js'e bağımlılığı yok) */
export const SLOT_COUNT = 54;
export const ROOT_R = 130;
export const SHRINK = 0.34;
export const SPHERE_K = 0.11;
export const PALETTE = [0x00d2ff,0xffa502,0x7d5fff,0x2ed573,0xff6b81,0x70a1ff,0xeccc68,0xff4757];
export const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function hashStr(s){
    let h=1779033703;
    for(let i=0;i<s.length;i++){ h=Math.imul(h^s.charCodeAt(i),3432918353); h=h<<13|h>>>19; }
    return h>>>0;
}
/* Başlığı KELİME sınırında kes + '…' */
export function truncTitle(t, max){
    if(t.length<=max) return t;
    let cut=t.slice(0,max);
    const sp=cut.lastIndexOf(' ');
    if(sp>5) cut=cut.slice(0,sp);
    return cut+'…';
}
export function genId(prefix){ return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
export function stripHtml(h){ const d=document.createElement('div'); d.innerHTML=h||''; return d.textContent||''; }

/* --- XSS SANİTİZASYONU ------------------------------------------------------
   Not gövdeleri innerHTML ile çizildiği için (özellikle PAYLAŞILAN evrenlerde)
   depolanmış-XSS'e karşı beyaz-liste temizliği zorunlu: yalnız biçim etiketleri
   kalır, TÜM öznitelikler (onerror, style, href...) atılır. */
const ALLOWED_TAGS = new Set(['H1','H2','H3','P','BR','B','STRONG','I','EM','U','S',
                              'UL','OL','LI','DIV','SPAN','BLOCKQUOTE','CODE','PRE']);
export function sanitizeHtml(html){
    if(!html) return '';
    const t=document.createElement('template');
    t.innerHTML=String(html);
    (function scrub(parent){
        for(const ch of [...parent.childNodes]){
            if(ch.nodeType===1){ // element
                if(!ALLOWED_TAGS.has(ch.tagName)){
                    const frag=document.createDocumentFragment();
                    while(ch.firstChild) frag.appendChild(ch.firstChild);
                    parent.replaceChild(frag, ch);
                    scrub(parent); return; // yapı değişti: ebeveyni yeniden tara
                }
                for(const a of [...ch.attributes]) ch.removeAttribute(a.name);
                scrub(ch);
            } else if(ch.nodeType!==3){ parent.removeChild(ch); } // yorum vb. at
        }
    })(t.content);
    return t.innerHTML;
}
/* varlık dataURL güvenliği: html/script taşıyabilecek türler reddedilir */
export function safeDataURL(u){
    return typeof u==='string' &&
        /^data:(image\/|application\/(pdf|zip|json|vnd\.|msword|octet-stream)|text\/(plain|csv|markdown))/i.test(u) &&
        !/^data:text\/html/i.test(u);
}
