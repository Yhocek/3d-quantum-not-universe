/* =============================================================================
   DataManager — veri modeli, standart JSON şeması, IndexedDB + sunucu varlık
   deposu, API istemcisi, defterler, zaman tüneli (versiyonlar), undo/redo, arama
   ============================================================================= */
import * as THREE from './three.js';
import { SLOT_COUNT, ROOT_R, SHRINK, genId, stripHtml, sanitizeHtml, safeDataURL } from './config.js';

/* ---------- global durum ---------- */
export const State = {
    notebooks: [], nbIndex: 0,
    openNode: null, selNode: null,
    mode: 'focus',             // 'flight' | 'focus' — varsayılan Odak (not alan kullanıcı için)
    renderDepth: 2,
    serverOn: false,
    searchHits: new Set(),     // parlatılacak düğüm id'leri
    linkFrom: null,            // kuantum bağlantı modu kaynağı
    onboardSlot: null,         // ilk kullanımda yeşil parlayan yuva indeksi
    user: null                 // {id, username} — oturum açıksa
};
export function currentNb(){ return State.notebooks[State.nbIndex]; }
export function currentRoot(){ const nb=currentNb(); return nb ? nb.root : null; }

/* ---------- 54 yuva yönü ---------- */
export const SLOT_DIRS = (function(){
    const rings = [
        {elev:  0.0, n:8, off: 0.0},
        {elev: 22.5, n:8, off:22.5}, {elev:-22.5, n:8, off:22.5},
        {elev: 45.0, n:8, off: 0.0}, {elev:-45.0, n:8, off: 0.0},
        {elev: 67.5, n:7, off: 0.0}, {elev:-67.5, n:7, off:25.7}
    ];
    const dirs=[];
    rings.forEach(r=>{
        const e=THREE.MathUtils.degToRad(r.elev);
        for(let k=0;k<r.n;k++){
            const a=THREE.MathUtils.degToRad(r.off + k*360/r.n);
            dirs.push(new THREE.Vector3(Math.cos(e)*Math.cos(a), Math.sin(e), Math.cos(e)*Math.sin(a)));
        }
    });
    return dirs;
})();

/* ---------- düğüm modeli ---------- */
export function makeNode(){
    return { id:genId('n'), title:'', html:'', slots:{}, images:[], docs:[],
             links:[], parent:null, slotIndex:null };
}
export function address(n){ const p=[]; while(n.parent){ p.unshift(n.slotIndex+1); n=n.parent; } return '0'+(p.length?'.'+p.join('.'):''); }
export function depthOf(n){ let d=0; while(n.parent){ d++; n=n.parent; } return d; }
export function countNodes(n){ let c=1; for(const k in n.slots) c+=countNodes(n.slots[k]); return c; }
export function filledSlots(n){ return Object.keys(n.slots).map(Number).sort((a,b)=>a-b); }
export function inTreeOf(n, root){ while(n){ if(n===root) return true; n=n.parent; } return false; }
export function nodeByAddress(root, addr){
    if(!addr || addr==='0') return root;
    let n=root;
    for(const part of addr.split('.').slice(1)){ n=n.slots[+part-1]; if(!n) return root; }
    return n;
}
export function worldOf(n){
    if(!n.parent) return { pos:new THREE.Vector3(0,0,0), radius:ROOT_R };
    const p=worldOf(n.parent);
    return { pos:p.pos.clone().addScaledVector(SLOT_DIRS[n.slotIndex], p.radius), radius:p.radius*SHRINK };
}

/* id → düğüm dizini (kuantum bağlantılar + arama için) */
let nodeIndex = new Map();
export function rebuildIndex(){
    nodeIndex = new Map();
    const root=currentRoot();
    if(root) (function walk(n){ nodeIndex.set(n.id,n); filledSlots(n).forEach(i=>walk(n.slots[i])); })(root);
    rebuildGlobalIndex(); // defterler arası bağlantı çözümü taze kalsın
}
export function nodeById(id){ return nodeIndex.get(id)||null; }

/* ---------- standart JSON şeması (id/label/type/size/children) ----------
   Görsel/belge ikilileri ağaçta TAŞINMAZ; yalnız assetId referansı durur. */
export function toStd(n, depth=0){
    const kids = filledSlots(n).map(i=>toStd(n.slots[i], depth+1));
    return {
        id:n.id, label:n.title||'untitled',
        type: depth===0?'macro_goal':(kids.length?'action':'micro_habit'),
        size: Math.max(5-2*depth,1),
        slot: n.slotIndex==null?null:n.slotIndex+1,
        html:n.html,
        images:n.images.map(a=>({assetId:a.assetId, name:a.name, aspect:a.aspect})),
        docs:n.docs.map(a=>({assetId:a.assetId, name:a.name, size:a.size})),
        links:n.links.slice(),
        children:kids
    };
}
export function fromStd(o){
    const n=makeNode();
    if(o.id) n.id=o.id;
    n.title=o.label!=null?o.label:(o.title||'');
    n.html=sanitizeHtml(o.html||''); n.links=(o.links||[]).slice();
    n.images=(o.images||[]).map(migrateAtt.bind(null,'img'));
    n.docs  =(o.docs  ||[]).map(migrateAtt.bind(null,'doc'));
    if(o.slots){ // eski v2 formatı
        for(const k in o.slots){ const c=fromStd(o.slots[k]); c.parent=n; c.slotIndex=+k; n.slots[+k]=c; }
        return n;
    }
    let next=0;
    (o.children||[]).forEach(k=>{
        let si=(k.slot!=null?k.slot-1:next);
        while(n.slots[si]!=null){ si=(si+1)%SLOT_COUNT; }
        const c=fromStd(k); c.parent=n; c.slotIndex=si; n.slots[si]=c; next=si+1;
    });
    return n;
}
/* eski gömülü dataURL'leri varlık deposuna göç ettir */
function migrateAtt(kind, a){
    if(a.assetId) return {assetId:a.assetId, name:a.name, aspect:a.aspect, size:a.size};
    const id=genId('a');
    const rec={id, name:a.name||'dosya', aspect:a.aspect||null, size:a.size||null, dataURL:a.dataURL};
    assetCache.set(id, rec);
    idbPut(rec).catch(()=>{});
    if(State.serverOn && State.user) api('assets',{method:'POST',body:JSON.stringify(rec)}).catch(()=>{});
    return {assetId:id, name:rec.name, aspect:rec.aspect, size:rec.size};
}

/* =============================================================================
   VARLIK DEPOSU — bellek önbelleği → IndexedDB → sunucu
   JSON ağacı küçük kalır; ikililer düğümün dışında yaşar.
   ============================================================================= */
const assetCache = new Map();
let idb=null;
function idbOpen(){
    if(idb) return Promise.resolve(idb);
    return new Promise((res)=>{
        try{
            const rq=indexedDB.open('not-evreni',2);
            rq.onupgradeneeded=()=>{
                const d=rq.result;
                if(!d.objectStoreNames.contains('assets')) d.createObjectStore('assets',{keyPath:'id'});
                if(!d.objectStoreNames.contains('trees'))  d.createObjectStore('trees',{keyPath:'key'});
            };
            rq.onsuccess=()=>{ idb=rq.result; res(idb); };
            rq.onerror=()=>res(null);
        }catch(e){ res(null); }
    });
}
/* --- AĞAÇ KALICILIĞI: çevrimdışıyken bile notlar sekme kapansa da yaşar --- */
function idbPutTree(rec){
    return idbOpen().then(d=>new Promise((res,rej)=>{
        if(!d) return rej();
        const tx=d.transaction('trees','readwrite');
        tx.objectStore('trees').put(rec);
        tx.oncomplete=res; tx.onerror=rej;
    }));
}
export function loadLocalTrees(){
    return idbOpen().then(d=>new Promise(res=>{
        if(!d || !d.objectStoreNames.contains('trees')) return res([]);
        const rq=d.transaction('trees').objectStore('trees').getAll();
        rq.onsuccess=()=>res(rq.result||[]);
        rq.onerror=()=>res([]);
    }));
}
let localTimer=null;
function scheduleLocalPersist(){ clearTimeout(localTimer); localTimer=setTimeout(persistLocal,800); }
export async function persistLocal(){
    const nb=currentNb(); if(!nb || !nb.root) return;
    if(!nb.localKey) nb.localKey = nb.id ? ('srv-'+nb.id) : genId('nb');
    try{ await idbPutTree({key:nb.localKey, id:nb.id||null, name:nb.name, root:toStd(nb.root), ts:Date.now()}); }
    catch(e){}
}
function idbPut(rec){
    return idbOpen().then(d=>new Promise((res,rej)=>{
        if(!d) return rej();
        const tx=d.transaction('assets','readwrite');
        tx.objectStore('assets').put(rec);
        tx.oncomplete=res; tx.onerror=rej;
    }));
}
function idbGet(id){
    return idbOpen().then(d=>new Promise((res)=>{
        if(!d) return res(null);
        const rq=d.transaction('assets').objectStore('assets').get(id);
        rq.onsuccess=()=>res(rq.result||null);
        rq.onerror=()=>res(null);
    }));
}
/* yeni varlık kaydet → {assetId,...} referansı döner */
export async function saveAsset({name, dataURL, aspect=null, size=null}){
    if(!safeDataURL(dataURL)) throw new Error('unsupported file type');
    const rec={id:genId('a'), name, dataURL, aspect, size};
    assetCache.set(rec.id, rec);
    idbPut(rec).catch(()=>{});
    if(State.serverOn && State.user) api('assets',{method:'POST',body:JSON.stringify(rec)}).catch(()=>{});
    return {assetId:rec.id, name, aspect, size};
}
/* assetId → tam kayıt (dataURL dahil) */
export async function resolveAsset(id){
    if(assetCache.has(id)) return assetCache.get(id);
    const local=await idbGet(id);
    if(local){ assetCache.set(id,local); return local; }
    if(State.serverOn){
        try{
            const rec=await api('assets/'+id);
            assetCache.set(id,rec); idbPut(rec).catch(()=>{});
            return rec;
        }catch(e){}
    }
    return null;
}

/* =============================================================================
   API İSTEMCİSİ + OTOMATİK KAYIT
   API tabanı dokümana göre çözülür: kökten sunulduğunda (node server.js) →
   "/api/", alt-dizinden (GitHub Pages user.github.io/repo/) → "/repo/api/"
   (backend yoksa 404 → sorunsuz çevrimdışı moda düşer). Konumdan bağımsız.
   ============================================================================= */
export const API_BASE = new URL('api/', document.baseURI).href;
export async function api(path, opts={}){
    const headers=Object.assign({'Content-Type':'application/json'}, opts.headers||{});
    if(csrfToken && opts.method && opts.method!=='GET') headers['X-CSRF']=csrfToken;
    const r=await fetch(API_BASE+path, Object.assign({}, opts, {headers, credentials:'same-origin'}));
    if(r.status===401 && !path.startsWith('auth/')) onAuthNeeded();
    if(!r.ok){
        let msg='api '+r.status;
        try{ const j=await r.json(); if(j.error) msg=j.error; }catch(e){}
        const err=new Error(msg); err.status=r.status; throw err;
    }
    return r.json();
}
let csrfToken=null;
let onAuthNeeded=()=>{};
export function setAuthNeeded(fn){ onAuthNeeded=fn; }
export async function probe(){
    try{
        const c=new AbortController(); setTimeout(()=>c.abort(),2000);
        const r=await fetch(API_BASE+'health',{signal:c.signal});
        /* statik host (Pages) /api/health için HTML 404 döndürebilir; JSON
           değilse backend yok say → çevrimdışı yerel mod */
        State.serverOn = r.ok && (r.headers.get('content-type')||'').includes('json');
    }catch(e){ State.serverOn=false; }
    if(State.serverOn){
        try{ const me=await api('auth/me'); State.user=me.user; csrfToken=me.csrf; }
        catch(e){ State.user=null; }
    }
    emitSave(State.serverOn ? (State.user?'saved':'off') : 'off');
    return State.serverOn;
}
export async function register(username,password){
    const r=await api('auth/register',{method:'POST', body:JSON.stringify({username,password})});
    State.user=r.user; csrfToken=r.csrf; return r.user;
}
export async function login(username,password){
    const r=await api('auth/login',{method:'POST', body:JSON.stringify({username,password})});
    State.user=r.user; csrfToken=r.csrf; return r.user;
}
export async function logout(){
    try{ await api('auth/logout',{method:'POST', body:'{}'}); }catch(e){}
    State.user=null; csrfToken=null;
}
let saveListener=()=>{};
export function onSaveState(fn){ saveListener=fn; }
function emitSave(s){ saveListener(s); }
let saveTimer=null;
export function markDirty(){
    scheduleLocalPersist(); // her durumda yerel ayna: veri kaybı yok
    if(!State.serverOn || !State.user){ emitSave('off'); return; }
    pendingSave=true;
    emitSave('dirty');
    clearTimeout(saveTimer);
    saveTimer=setTimeout(saveNow,1200);
}
let pendingSave=false;
export function hasPendingSave(){ return pendingSave; }
export async function saveNow(){
    const nb=currentNb();
    if(!State.serverOn || !State.user || !nb || !nb.id) return;
    emitSave('saving');
    try{
        const r=await api('notebooks/'+nb.id,{method:'PUT',body:JSON.stringify({name:nb.name, root:toStd(nb.root)})});
        nb.updatedAt=r.updatedAt||Date.now(); // canlı senkron kendi yazdığımızı geri çekmesin
        pendingSave=false;
        emitSave('saved');
    }catch(e){ State.serverOn=false; emitSave('off'); }
}

/* ---------- tohum evren: ilk açılış boş olmasın, "Aha!" 15 saniyede gelsin ---------- */
export function seedRoot(){
    const root=makeNode(); root.title='Main Hub';
    root.html='<h1>My Mind Map</h1><p>Click the glowing green slot — your first note is born there.</p>';
    const mk=(parent,slot,title,html)=>{ const n=makeNode(); n.title=title; n.html=html||'';
        n.parent=parent; n.slotIndex=slot; parent.slots[slot]=n; return n; };
    const kilo=mk(root,11,'Lose 20 Kilos','<h2>Plan</h2><p>Slow but lasting.</p>');
    mk(kilo,0,'Take the stairs'); mk(kilo,2,'Quit sugar');
    mk(root,20,'Projects'); mk(root,29,'Reading List'); mk(root,38,'Ideas ∞');
    return root;
}

/* ---------- defterler ---------- */
export async function loadNotebookList(){
    if(!State.serverOn) return;
    try{
        const list=await api('notebooks');
        list.forEach(m=>State.notebooks.push({id:m.id, name:m.name, root:null, updatedAt:m.updatedAt||0}));
        if(!State.notebooks.length){
            const seed=seedRoot();
            const created=await api('notebooks',{method:'POST',body:JSON.stringify({name:'Notebook 1', root:toStd(seed)})});
            State.notebooks.push({id:created.id, name:created.name, root:seed});
        }
    }catch(e){ State.serverOn=false; emitSave('off'); }
}
export async function ensureRoot(nb){
    if(nb.root) return nb.root;
    if(State.serverOn && nb.id){
        try{ const full=await api('notebooks/'+nb.id); nb.root=fromStd(full.root); }
        catch(e){ nb.root=makeNode(); nb.root.title='Main Hub'; }
    } else { nb.root=makeNode(); nb.root.title='Main Hub'; }
    return nb.root;
}
export async function createNotebook(name){
    const nb={id:null, name, root:makeNode()};
    nb.root.title='Main Hub';
    if(State.serverOn){
        try{ const c=await api('notebooks',{method:'POST',body:JSON.stringify({name, root:toStd(nb.root)})});
             nb.id=c.id; }catch(e){}
    }
    State.notebooks.push(nb);
    return nb;
}

/* ---------- ZAMAN TÜNELİ (versiyonlar) ---------- */
export async function listVersions(){
    const nb=currentNb();
    if(!State.serverOn || !nb.id) return [];
    try{ return await api('notebooks/'+nb.id+'/versions'); }catch(e){ return []; }
}
export async function getVersion(i){
    const nb=currentNb();
    return api('notebooks/'+nb.id+'/versions/'+i);
}
export async function snapshotNow(){
    const nb=currentNb();
    if(!State.serverOn || !nb.id) throw new Error('offline');
    await saveNow();
    return api('notebooks/'+nb.id+'/versions',{method:'POST',body:'{}'});
}

/* ---------- UNDO / REDO (Ctrl+Z / Ctrl+Y) ---------- */
const undoStack=[], redoStack=[];
export function pushUndo(){
    const root=currentRoot(); if(!root) return;
    undoStack.push(JSON.stringify(toStd(root)));
    if(undoStack.length>30) undoStack.shift();
    redoStack.length=0;
}
export function undo(){ return timeShift(undoStack, redoStack); }
export function redo(){ return timeShift(redoStack, undoStack); }
function timeShift(from, to){
    const nb=currentNb();
    if(!from.length || !nb) return null;
    to.push(JSON.stringify(toStd(nb.root)));
    nb.root=fromStd(JSON.parse(from.pop()));
    rebuildIndex();
    markDirty();
    return nb.root;
}
/* versiyon geri yükleme: geçmiş kök şimdiki olur (öncesi undo'ya girer) */
export function restoreRoot(stdRoot){
    const nb=currentNb(); if(!nb) return null;
    pushUndo();
    nb.root=fromStd(stdRoot);
    rebuildIndex();
    markDirty();
    return nb.root;
}

/* ---------- GLOBAL ARAMA ---------- */
export function search(q){
    q=q.trim().toLowerCase();
    State.searchHits.clear();
    if(!q) return [];
    const root=currentRoot(); if(!root) return [];
    const out=[];
    (function walk(n){
        const title=(n.title||'').toLowerCase();
        const body=stripHtml(n.html).toLowerCase();
        let hit=title.includes(q), snip='';
        if(!hit && body.includes(q)){
            hit=true;
            const i=body.indexOf(q);
            snip='…'+body.slice(Math.max(0,i-14), i+q.length+22)+'…';
        }
        if(hit){ State.searchHits.add(n.id); out.push({node:n, snip}); }
        if(out.length<60) filledSlots(n).forEach(i=>walk(n.slots[i]));
    })(root);
    return out.slice(0,30);
}
export function clearSearch(){ State.searchHits.clear(); }

/* ---------- kuantum bağlantı (solucan deliği) ---------- */
export function linkNodes(a,b){
    if(!a||!b||a===b) return false;
    if(!a.links.includes(b.id)) a.links.push(b.id);
    if(!b.links.includes(a.id)) b.links.push(a.id);
    markDirty();
    return true;
}
export function unlink(a,ref){
    a.links=a.links.filter(x=>x!==ref);
    const r=resolveLink(ref);
    if(r){
        r.node.links=r.node.links.filter(x=>linkNodeId(x)!==a.id);
        if(r.nbIndex!==State.nbIndex) saveOther(State.notebooks[r.nbIndex]);
    }
    markDirty();
}

/* ============================================================================
   OBSİDİYEN TARZI BEYİN AĞI — defterler arası bağlantılar + global grafik
   Bağlantı biçimi: aynı defter → "nodeId" (eski biçim), defterler arası →
   "nbKey:nodeId". nbKey = sunucu defter id'si ya da yerel localKey; sunucu
   şeması değişmez (links: string ≤64). Tüm bağlantılar çift yönlüdür.
   ============================================================================ */
export function nbKey(nb){
    if(nb.id) return nb.id;
    if(!nb.localKey) nb.localKey=genId('nb');
    return nb.localKey;
}
export const linkNodeId = l => l.includes(':') ? l.split(':').pop() : l;
export async function ensureAllRoots(){
    for(const nb of State.notebooks) await ensureRoot(nb);
    rebuildGlobalIndex();
}
let globalIndex=new Map(); // nodeId → {node, nbIndex} (yüklü tüm defterler)
export function rebuildGlobalIndex(){
    globalIndex=new Map();
    State.notebooks.forEach((nb,i)=>{
        if(!nb.root) return;
        (function walk(n){ globalIndex.set(n.id,{node:n,nbIndex:i}); filledSlots(n).forEach(k=>walk(n.slots[k])); })(nb.root);
    });
}
/* "nbKey:nodeId" ya da "nodeId" → {node, nbIndex} | null */
export function resolveLink(l){
    const nid=linkNodeId(l);
    const local=nodeById(nid);
    if(local) return {node:local, nbIndex:State.nbIndex};
    return globalIndex.get(nid)||null;
}
/* a (geçerli defter) ⇄ b (nbB defteri) — defterler arası solucan deliği */
export function linkNodesX(a, b, nbB){
    if(!a||!b||a===b) return false;
    const nbA=currentNb();
    const refB = nbB===nbA ? b.id : nbKey(nbB)+':'+b.id;
    const refA = nbB===nbA ? a.id : nbKey(nbA)+':'+a.id;
    if(!a.links.includes(refB)) a.links.push(refB);
    if(!b.links.includes(refA)) b.links.push(refA);
    rebuildGlobalIndex();
    markDirty();
    if(nbB!==nbA) saveOther(nbB);
    return true;
}
/* geçerli olmayan bir defteri kalıcıla (IndexedDB aynası + sunucu) */
export async function saveOther(nb){
    if(!nb.localKey) nb.localKey = nb.id ? ('srv-'+nb.id) : genId('nb');
    try{ await idbPutTree({key:nb.localKey, id:nb.id||null, name:nb.name, root:toStd(nb.root), ts:Date.now()}); }catch(e){}
    if(State.serverOn && State.user && nb.id){
        try{ await api('notebooks/'+nb.id,{method:'PUT',body:JSON.stringify({name:nb.name, root:toStd(nb.root)})}); }catch(e){}
    }
}
/* başlığa göre tüm defterlerde not ara ([[wikilink]] hedef çözümü) */
export function nodeByTitle(title, exclude){
    const q=String(title).trim().toLowerCase();
    if(!q) return null;
    let hit=null;
    State.notebooks.forEach((nb,i)=>{
        if(hit||!nb.root) return;
        (function walk(n){
            if(hit) return;
            if(n!==exclude && (n.title||'').trim().toLowerCase()===q){ hit={node:n, nbIndex:i}; return; }
            filledSlots(n).forEach(k=>walk(n.slots[k]));
        })(nb.root);
    });
    return hit;
}
/* beyin grafiği: tüm defterler tek grafikte — düğümler + ağaç/solucan kenarları */
export function brainGraph(cap=900){
    const nodes=[], edges=[], idx=new Map();
    State.notebooks.forEach((nb,i)=>{
        if(!nb.root) return;
        (function walk(n,parent,d){
            if(nodes.length>=cap) return;
            const me=nodes.length;
            idx.set(n.id, me);
            nodes.push({node:n, nbIndex:i, deg:0, depth:d, isRoot:parent==null});
            if(parent!=null){ edges.push({a:parent,b:me,type:'tree'}); nodes[parent].deg++; nodes[me].deg++; }
            filledSlots(n).forEach(k=>walk(n.slots[k], me, d+1));
        })(nb.root, null, 0);
    });
    /* ORTAK KÜMELER: farklı defterlerde aynı başlık YOLUNA sahip dallanan
       düğümler (örn. her iki defterde de "Dersler/Matematik") ikiz sayılır;
       ikiz kenarının ağırlığı paylaşılan çocuk başlığı sayısıyla artar →
       çizim kalınlığı bundan türetilir. */
    const byPath=new Map();
    nodes.forEach((rec,i)=>{
        if(rec.isRoot || !filledSlots(rec.node).length) return;
        const parts=[]; let n=rec.node;
        while(n && n.parent){ parts.unshift((n.title||'').trim().toLowerCase()); n=n.parent; }
        if(parts.some(t=>!t)) return; // adsız düzey varsa eşleşme yok
        const key=parts.join('/');
        (byPath.get(key)||byPath.set(key,[]).get(key)).push(i);
    });
    byPath.forEach(list=>{
        for(let x=0;x<list.length;x++) for(let y=x+1;y<list.length;y++){
            const A=nodes[list[x]], B=nodes[list[y]];
            if(A.nbIndex===B.nbIndex) continue;
            const ta=new Set(filledSlots(A.node).map(k=>(A.node.slots[k].title||'').trim().toLowerCase()).filter(Boolean));
            let shared=0;
            filledSlots(B.node).forEach(k=>{ if(ta.has((B.node.slots[k].title||'').trim().toLowerCase())) shared++; });
            edges.push({a:list[x], b:list[y], type:'twin', w:1+shared});
            A.deg++; B.deg++;
        }
    });
    nodes.forEach((rec,ai)=>{ // solucan delikleri (her çift bir kez)
        (rec.node.links||[]).forEach(l=>{
            const bi=idx.get(linkNodeId(l));
            if(bi!=null && bi>ai){
                edges.push({a:ai,b:bi,type:nodes[bi].nbIndex!==rec.nbIndex?'cross':'worm'});
                nodes[ai].deg++; nodes[bi].deg++;
            }
        });
    });
    return {nodes, edges, capped:nodes.length>=cap};
}
