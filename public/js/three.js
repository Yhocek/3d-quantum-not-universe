/* Tek noktadan Three.js — artık YEREL vendor'dan (CSP: script-src 'self').
   'three' çıplak belirteci index.html'deki import map ile çözülür; jsm
   eklentileri de aynı haritayı kullanır → tek modül örneği garantili.
   Vite'a geçiş: import map'i kaldır, npm i three, bu dosya değişmez. */
export * from 'three';
/* JSM tabanı konumdan bağımsız: bu modülün URL'sine göre çözülür → hem kök
   (node server.js) hem de GitHub Pages alt-dizini (user.github.io/repo/) çalışır */
export const JSM_BASE = new URL('../vendor/three/examples/jsm/', import.meta.url).href;
