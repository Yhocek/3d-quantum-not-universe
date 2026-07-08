/* Tek noktadan Three.js — artık YEREL vendor'dan (CSP: script-src 'self').
   'three' çıplak belirteci index.html'deki import map ile çözülür; jsm
   eklentileri de aynı haritayı kullanır → tek modül örneği garantili.
   Vite'a geçiş: import map'i kaldır, npm i three, bu dosya değişmez. */
export * from 'three';
export const JSM_BASE = '/vendor/three/examples/jsm/';
