/* =============================================================================
   UIManager — paneller, hızlı menü, YAKLAŞ butonu, global arama, zaman tüneli,
   kuantum bağlantı arayüzü, 2B indirgeme, paylaşım, URL durumu, içe/dışa aktarım
   ============================================================================= */
import { SLOT_COUNT, REDUCED, genId, sanitizeHtml, stripHtml, hashStr, PALETTE } from './config.js';
import * as D from './DataManager.js';
import { State } from './DataManager.js';
import * as Engine from './Engine3D.js';
import * as Controls from './Controls.js';

const $=id=>document.getElementById(id);
let titleIn, bodyEd, qTitle, quick, subcard, tip;
let quickOn=false, cardNode=null, cardPos=null, cardHover=false, cardHideT=null;

/* ============================================================== BAŞLATMA */
export function init(){
    titleIn=$('title-in'); bodyEd=$('body-ed'); qTitle=$('q-title');
    quick=$('quick'); subcard=$('subcard'); tip=$('tip');

    Engine.setViewChanged(()=>{
        updatePanel(); syncURL();
        cardHide(); // eski küme kartı bayatladı
        if(quickOn){ qTitle.value=State.openNode.title; renderContentLists(State.openNode,'q'); }
        maybeOnboard();
    });
    Controls.setHandlers(hoverCheck, clickCheck);
    Controls.setOverlayCheck(()=> $('twod').classList.contains('open') ||
                                  $('tunnel').classList.contains('open') ||
                                  $('brain').classList.contains('open') ||
                                  $('xlink').classList.contains('open') ||
                                  $('auth').classList.contains('show'));
    D.onSaveState(setSaveDot);
    setSaveDot(State.serverOn ? 'saved' : 'off'); // probe UI'dan önce koştu; ilk durumu şimdi bas

    bindPanel(); bindQuick(); bindCard(); bindSearch(); bindModes(); bindAuth();
    bindButtons(); bindTunnel(); bindTwod(); bindFiles(); bindKeys();
    bindBrain(); bindXlink(); bindTheme();
    startMcpSync();
    window.addEventListener('mousemove', tipMove);
    window.addEventListener('resize', ()=>{ if($('twod').classList.contains('open')) drawTwod(); });
}

/* ============================================================ KİMLİK UI ====
   Sunucu açık + oturum yoksa katman gösterilir. Kullanıcı giriş/kayıt yapar
   (başarıda sayfa yenilenir: çerez + CSRF temiz kurulum) ya da hesapsız
   yerel modda devam eder. Otomatik kayıt 401 alırsa katman yeniden açılır.
   ========================================================================== */
let authMode='login';
function bindAuth(){
    D.setAuthNeeded(()=>{ showAuth(); });
    $('auth-tab-login').onclick=()=>setAuthMode('login');
    $('auth-tab-register').onclick=()=>setAuthMode('register');
    $('auth-submit').onclick=authSubmit;
    $('auth-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') authSubmit(); });
    $('auth-local').onclick=()=>{
        $('auth').classList.remove('show');
        State.serverOn=false; setSaveDot('off');
        toast('Local mode: your data is stored in this browser (IndexedDB).');
    };
    $('btn-logout').onclick=async()=>{ await D.logout(); location.reload(); };
    refreshUserChip();
}
function setAuthMode(m){
    authMode=m;
    $('auth-tab-login').classList.toggle('on', m==='login');
    $('auth-tab-register').classList.toggle('on', m==='register');
    $('auth-submit').textContent = m==='login' ? 'LOG IN' : 'CREATE ACCOUNT';
    $('auth-pass').autocomplete = m==='login' ? 'current-password' : 'new-password';
    $('auth-err').textContent='';
}
export function showAuth(){
    $('auth').classList.add('show');
    $('auth-user').focus();
}
async function authSubmit(){
    const u=$('auth-user').value.trim(), p=$('auth-pass').value;
    $('auth-err').textContent='';
    try{
        if(authMode==='login') await D.login(u,p);
        else await D.register(u,p);
        location.reload(); // çerez kuruldu: temiz önyükleme
    }catch(e){ $('auth-err').textContent=e.message; }
}
function refreshUserChip(){
    if(State.user){
        $('user-chip').style.display='inline';
        $('user-chip').textContent='⚛ '+State.user.username;
        $('btn-logout').style.display='inline-block';
    }
}

/* ============================================================ KAYIT DURUMU */
function setSaveDot(s){
    const el=$('save-dot');
    el.textContent={saved:'● synced', saving:'● saving…', dirty:'● will save',
                    off:'○ offline — local save active (IndexedDB)'}[s];
    el.style.color={saved:'#2ed573', saving:'#ffa502', dirty:'#ffa502', off:'#57606f'}[s];
}

/* ============================================ ONBOARDING (engelsiz) ========
   Taze evrende bir boş yuva yeşil nabızla parlar + uzamsal çağrı gösterilir.
   İlk not doğunca kalıcı olarak söner. Modal yok, okuma duvarı yok.
   ========================================================================== */
let onboardDone=false;
function maybeOnboard(){
    const root=D.currentRoot();
    const fresh = !onboardDone && root && D.countNodes(root)<10 &&
                  State.openNode===root && Engine.slotInst.length>0;
    if(fresh){
        /* kameraya en yakın (spawn yönündeki) boş yuvayı seç: görüş alanında olsun */
        let best=Engine.slotInst[0], bd=Infinity;
        for(const s of Engine.slotInst){
            const d=Engine.camera ? Engine.camera.position.distanceTo(s.pos) : 0;
            if(d<bd){ bd=d; best=s; }
        }
        State.onboardSlot=best.slotIndex;
        $('onboard').classList.add('show');
    }else{
        State.onboardSlot=null;
        $('onboard').classList.remove('show');
        $('slot-callout').classList.remove('show');
    }
}
function onboardComplete(){
    if(onboardDone) return;
    onboardDone=true;
    State.onboardSlot=null;
    $('onboard').classList.remove('show');
    $('slot-callout').classList.remove('show');
}

/* =============================================================== URL DURUMU */
export function syncURL(){
    try{
        const p=new URLSearchParams();
        const nb=D.currentNb();
        if(nb && nb.id) p.set('nb', nb.id);
        if(State.openNode) p.set('focus', D.address(State.openNode));
        p.set('depth', State.renderDepth);
        history.replaceState(null,'','?'+p.toString());
    }catch(e){}
}

/* ================================================================ MODLAR */
function bindModes(){
    $('mode-flight').onclick=()=>modeSet('flight');
    $('mode-focus').onclick=()=>modeSet('focus');
    $('depth-sel').addEventListener('change', e=>{
        State.renderDepth=+e.target.value;
        if(State.openNode) Engine.buildView(State.openNode);
    });
}
function modeSet(m){
    Controls.setMode(m);
    $('mode-flight').classList.toggle('on', m==='flight');
    $('mode-focus').classList.toggle('on', m==='focus');
    toast(m==='flight' ? '🚀 Flight mode: fly freely with WASD'
                       : '🎯 Focus mode: click an atom → smooth approach, drag → orbit');
}
export function applyModeUI(){ $('mode-'+State.mode).classList.add('on'); }

/* =============================================================== RAYCAST */
function hoverCheck(e){
    const h=Engine.pick(e);
    const {atomsMesh, slotsMesh}=Engine.getMeshes();
    let hA=-1, hS=-1, txt='';
    if(h){
        if(h.object===atomsMesh){
            hA=h.instanceId;
            const a=Engine.atomInst[hA];
            if(a){
                if(a.kind==='portal'){
                    txt=a.xnb!=null
                        ? '🧠 '+State.notebooks[a.xnb].name+' → '+D.address(a.node)+(a.node.title?' — '+a.node.title:'')+' · click: teleport to notebook'
                        : '🕳 '+D.address(a.node)+(a.node.title?' — '+a.node.title:'')+' · click: teleport';
                }else{
                    txt=D.address(a.node)+(a.node.title?' — '+a.node.title:' — untitled');
                    if(a.kind!=='open') cardShow(a.node, a.pos);
                }
            }
        } else if(h.object===slotsMesh){
            hS=h.instanceId;
            const d=Engine.slotInst[hS];
            if(d && State.openNode) txt=D.address(State.openNode)+'.'+(d.slotIndex+1)+' — empty slot · click: spawn a note';
        } else if(h.object.isSprite){
            txt=h.object.userData.type==='doc' ? h.object.userData.att.name+' · click: download' : h.object.userData.att.name;
        }
    }
    Engine.setHover(hA,hS);
    if(hA<0 || (Engine.atomInst[hA] && (Engine.atomInst[hA].kind==='open'||Engine.atomInst[hA].kind==='portal'))) cardScheduleHide();
    Engine.canvas.classList.toggle('hovering', !!txt);
    tipShow(txt);
}
function clickCheck(e){
    const h=Engine.pick(e);
    if(!h) return;
    const {atomsMesh, slotsMesh}=Engine.getMeshes();
    if(h.object===atomsMesh){
        const a=Engine.atomInst[h.instanceId]; if(!a) return;
        /* kuantum bağlantı modu: ikinci atom seçiliyor */
        if(State.linkFrom && a.kind!=='portal'){
            if(D.linkNodes(State.linkFrom, a.node)){
                toast('🕳 Wormhole created: '+D.address(State.linkFrom)+' ⇄ '+D.address(a.node));
            }
            endLinkMode();
            Engine.buildView(State.openNode);
            return;
        }
        if(a.kind==='portal'){ // ışınlan!
            const t=a.node;
            if(a.xnb!=null && a.xnb!==State.nbIndex){ // defterler arası geçiş
                toast('🧠 Teleporting across notebooks → '+State.notebooks[a.xnb].name);
                switchNotebook(a.xnb).then(()=>{
                    State.selNode=t; Engine.buildView(t); Controls.spawnNear(t); updatePanel();
                });
                return;
            }
            toast('🕳 Teleporting → '+D.address(t));
            State.selNode=t;
            Engine.buildView(t);
            Controls.spawnNear(t);
            return;
        }
        State.selNode=a.node; updatePanel();
        if(a.kind==='parent') Engine.buildView(a.node);
        if(State.mode==='focus'){ Engine.buildView(a.node); Controls.focusOn(a.node,false); }
    } else if(h.object===slotsMesh){
        const d=Engine.slotInst[h.instanceId]; if(!d) return;
        onboardComplete(); // ilk not doğdu: rehberlik söner
        D.pushUndo();
        const c=D.makeNode(); c.parent=State.openNode; c.slotIndex=d.slotIndex;
        State.openNode.slots[d.slotIndex]=c;
        D.rebuildIndex();
        State.selNode=c;
        Engine.buildView(State.openNode);
        D.markDirty();
        toast('Note born: '+D.address(c));
        $('title-in').focus();
    } else if(h.object.isSprite && h.object.userData.type==='doc'){
        downloadAsset(h.object.userData.att);
    }
}
async function downloadAsset(att){
    const rec=await D.resolveAsset(att.assetId);
    if(!rec){ toast('File not found (may be offline).'); return; }
    const a=document.createElement('a'); a.href=rec.dataURL; a.download=rec.name; a.click();
}

/* ===================================================== YAKLAŞ + HIZLI MENÜ */
/* ============================= UZAMSAL İÇERİK KARTI (alt merkezler) =========
   Bir çocuk/üst atomun üzerine gelince yanında 3B'ye çapalı kart belirir:
   başlık+adres, alt notların listesi, belgeler, görsel küçükleri, 🎯 Yaklaş.
   ========================================================================== */
function bindCard(){
    subcard.addEventListener('mouseenter',()=>cardHover=true);
    subcard.addEventListener('mouseleave',()=>{ cardHover=false; cardScheduleHide(); });
    $('sc-go').onclick=()=>{
        if(!cardNode) return;
        State.selNode=cardNode; updatePanel();
        if(State.mode==='focus'){ Engine.buildView(cardNode); Controls.focusOn(cardNode,false); }
        else Controls.flyTo(cardNode);
        cardHide();
    };
    $('sc-sel').onclick=()=>{
        if(!cardNode) return;
        State.selNode=cardNode; updatePanel();
        toast('Selected: '+D.address(cardNode)+' — edit in the right panel');
    };
}
function cardShow(node,pos){
    if(State.linkFrom) return; // bağlantı modunda hedefi kapatma
    if(cardNode!==node) fillCard(node);
    cardNode=node; cardPos=pos;
    clearTimeout(cardHideT);
    subcard.classList.add('open');
}
function cardScheduleHide(){
    clearTimeout(cardHideT);
    cardHideT=setTimeout(()=>{ if(!cardHover) cardHide(); },400);
}
function cardHide(){ cardNode=null; subcard.classList.remove('open'); }
function fillCard(node){
    subcard.querySelector('.sc-addr').textContent=D.address(node);
    subcard.querySelector('.sc-title').textContent=node.title||'untitled';
    renderContentLists(node,'sc');
}
/* Not/belge/görsel listeleri — kart ('sc') ve hızlı menü ('q') paylaşır */
function elMk(tag,cls,txt){ const e=document.createElement(tag); e.className=cls; if(txt!=null) e.textContent=txt; return e; }
function renderContentLists(node, prefix){
    const notesEl=$(prefix+'-notes'), docsEl=$(prefix+'-docs'), imgsEl=$(prefix+'-imgs');
    /* 📝 notlar (alt atomlar) */
    notesEl.innerHTML='';
    const kids=D.filledSlots(node);
    if(kids.length){
        notesEl.appendChild(elMk('span','sc-k','📝 '+kids.length+':'));
        kids.slice(0,4).forEach(i=>{
            const c=node.slots[i];
            const b=elMk('span','sc-item','.'+(i+1)+' '+(c.title||'untitled'));
            b.title=D.address(c)+' — select';
            b.onclick=()=>{ State.selNode=c; updatePanel(); };
            notesEl.appendChild(b);
        });
        if(kids.length>4) notesEl.appendChild(elMk('span','sc-more','+'+(kids.length-4)));
    } else notesEl.appendChild(elMk('span','sc-empty','📝 no subnotes'));
    /* 📄 belgeler */
    docsEl.innerHTML='';
    if(node.docs.length){
        docsEl.appendChild(elMk('span','sc-k','📄'));
        node.docs.slice(0,3).forEach(a=>{
            const b=elMk('span','sc-item',a.name);
            b.title=a.name+' — download';
            b.onclick=()=>downloadAsset(a);
            docsEl.appendChild(b);
        });
        if(node.docs.length>3) docsEl.appendChild(elMk('span','sc-more','+'+(node.docs.length-3)));
    } else docsEl.appendChild(elMk('span','sc-empty','📄 no documents'));
    /* 📷 görsel küçükleri (assetId'den asenkron) */
    imgsEl.innerHTML='';
    if(node.images.length){
        node.images.slice(0,4).forEach(a=>{
            const im=document.createElement('img'); im.alt=a.name; im.title=a.name;
            D.resolveAsset(a.assetId).then(rec=>{ if(rec) im.src=rec.dataURL; });
            imgsEl.appendChild(im);
        });
        if(node.images.length>4) imgsEl.appendChild(elMk('span','sc-more','+'+(node.images.length-4)));
    } else imgsEl.appendChild(elMk('span','sc-empty','📷 no images'));
}
function bindQuick(){
    qTitle.addEventListener('input',()=>{
        if(!State.openNode) return;
        State.openNode.title=qTitle.value;
        Engine.refreshLabelFor(State.openNode);
        if(State.selNode===State.openNode){ titleIn.value=qTitle.value; renderSublistThrottled(); }
        D.markDirty();
    });
    qTitle.addEventListener('keydown',e=>{ if(e.key==='Enter') qTitle.blur(); });
    $('q-note').onclick=()=>{
        State.selNode=State.openNode; updatePanel();
        const note=$('note');
        if(innerWidth<=820) note.classList.add('force');
        note.classList.remove('flash'); void note.offsetWidth; note.classList.add('flash');
        bodyEd.focus();
    };
    $('q-img').onclick=()=>{ State.selNode=State.openNode; updatePanel(); $('img-in').click(); };
    $('q-doc').onclick=()=>{ State.selNode=State.openNode; updatePanel(); $('doc-in').click(); };
}
export function updateOverlays(){
    if(cardNode && cardPos){
        const sp=Engine.toScreen(cardPos);
        if(sp){
            subcard.style.left=Math.min(Math.max(sp.x+22,8), innerWidth-268)+'px';
            subcard.style.top =Math.min(Math.max(sp.y-30,8), innerHeight-190)+'px';
        } else cardHide();
    }
    /* onboarding çağrısı: parlayan yuvaya çapalı */
    if(State.onboardSlot!=null){
        const co=$('slot-callout');
        const d=Engine.slotInst.find(s=>s.slotIndex===State.onboardSlot);
        const sp=d && Engine.toScreen(d.pos);
        if(sp){
            co.style.left=Math.min(Math.max(sp.x+14,8), innerWidth-230)+'px';
            co.style.top =Math.min(Math.max(sp.y-34,8), innerHeight-48)+'px';
            co.classList.add('show');
        } else co.classList.remove('show');
    }
    if(!State.openNode) return;
    const W=D.worldOf(State.openNode);
    const near=Engine.camera.position.distanceTo(W.pos) < W.radius*1.15;
    if(near && !Controls.overlayOpen() && !Controls.dragging && !State.linkFrom){
        if(!quickOn){
            quickOn=true; quick.classList.add('open');
            quick.querySelector('.q-addr').textContent='⚛ '+D.address(State.openNode);
            qTitle.value=State.openNode.title;
            renderContentLists(State.openNode,'q');
            State.selNode=State.openNode; updatePanel();
        }
        const sp=Engine.toScreen(W.pos);
        if(sp){
            quick.style.left=Math.min(Math.max(sp.x+46,8), innerWidth-240)+'px';
            quick.style.top =Math.min(Math.max(sp.y-40,8), innerHeight-160)+'px';
            quick.style.visibility='visible';
        } else quick.style.visibility='hidden';
    } else if(quickOn && document.activeElement!==qTitle){
        quickOn=false; quick.classList.remove('open');
    }
}

/* ============================================================= NOT PANELİ */
function bindPanel(){
    titleIn.addEventListener('input',()=>{
        if(!State.selNode) return;
        State.selNode.title=titleIn.value;
        Engine.refreshLabelFor(State.selNode);
        if(State.selNode===State.openNode) qTitle.value=titleIn.value;
        renderSublistThrottled(); D.markDirty();
    });
    bodyEd.addEventListener('input',()=>{ if(State.selNode){ State.selNode.html=sanitizeHtml(bodyEd.innerHTML); D.markDirty(); }});
    bodyEd.addEventListener('paste', e=>{ // XSS: pano HTML'i düz metne indirgenir
        e.preventDefault();
        const t=(e.clipboardData||window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, t);
    });
    $('note-close').onclick=()=>$('note').classList.remove('force');
    $('btn-att-img').onclick=()=>$('img-in').click();
    $('btn-att-doc').onclick=()=>$('doc-in').click();
    document.querySelectorAll('#fmt button').forEach(b=>{
        b.addEventListener('mousedown',e=>e.preventDefault());
        b.addEventListener('click',()=>{
            bodyEd.focus();
            const tag=b.dataset.tag;
            if(!document.execCommand('formatBlock',false,tag))
                document.execCommand('formatBlock',false,'<'+tag+'>');
            if(State.selNode){ State.selNode.html=sanitizeHtml(bodyEd.innerHTML); D.markDirty(); }
        });
    });
    $('link-start').onclick=()=>{
        State.linkFrom=State.selNode;
        document.body.classList.add('linking');
        $('link-hint').textContent='🕳 pick a target atom for '+D.address(State.selNode)+' (ESC: cancel)';
        toast('Link mode: click a target atom.');
    };
    $('link-x').onclick=openXlink;
    /* [[wikilink]] (Obsidian): gövdede [[Başlık]] geçen notlara odak
       kaybında otomatik solucan deliği kurulur — defterler arası dahil */
    bodyEd.addEventListener('blur', parseWikilinks);
}
async function parseWikilinks(){
    const sel=State.selNode; if(!sel) return;
    const names=[...new Set([...stripHtml(sel.html).matchAll(/\[\[([^\[\]]{1,80})\]\]/g)]
        .map(m=>m[1].trim()).filter(Boolean))];
    if(!names.length) return;
    await D.ensureAllRoots();
    let made=0;
    for(const name of names){
        const hit=D.nodeByTitle(name, sel);
        if(!hit) continue;
        if(sel.links.some(l=>D.linkNodeId(l)===hit.node.id)) continue; // zaten bağlı
        D.linkNodesX(sel, hit.node, State.notebooks[hit.nbIndex]);
        made++;
    }
    if(made){
        Engine.buildView(State.openNode); renderSublist();
        toast('🧠 '+made+' [[wikilink]] became wormhole(s).');
    }
}
export function endLinkMode(){ State.linkFrom=null; document.body.classList.remove('linking'); }

export function updatePanel(){
    const sel=State.selNode; if(!sel) return;
    const addrEl=$('addr'); addrEl.innerHTML='';
    const chain=[]; let n=sel; while(n){ chain.unshift(n); n=n.parent; }
    chain.forEach((p,i)=>{
        const s=document.createElement('span');
        s.textContent=i===0?'0':'.'+(p.slotIndex+1);
        if(i<chain.length-1){ s.className='crumb'; s.onclick=()=>{ State.selNode=p; Engine.buildView(p); Controls.flyTo(p); }; }
        addrEl.appendChild(s);
    });
    const ttl=document.createElement('span'); ttl.style.color='#57606f';
    ttl.textContent=' · '+(sel===State.openNode?'OPEN CLUSTER':'selected'); addrEl.appendChild(ttl);

    titleIn.value=sel.title;
    bodyEd.innerHTML=sanitizeHtml(sel.html);
    renderAttachLists();
    renderSublist();
    const root=D.currentRoot();
    $('st-total').innerText=root?D.countNodes(root):0;
    $('st-depth').innerText=State.openNode?D.depthOf(State.openNode):0;
    $('st-active').innerText=Engine.atomInst.length+Engine.slotInst.length;
}

/* ekler paneli — küçük görseller assetId'den asenkron çözülür */
function renderAttachLists(){
    const sel=State.selNode;
    const il=$('img-list'); il.innerHTML='';
    sel.images.forEach((a,i)=>{
        const d=document.createElement('div'); d.className='att-img';
        const img=document.createElement('img'); img.alt=a.name; img.title=a.name;
        D.resolveAsset(a.assetId).then(rec=>{ if(rec) img.src=rec.dataURL; });
        d.appendChild(img);
        const x=document.createElement('button'); x.className='att-x'; x.textContent='×';
        x.onclick=()=>{ sel.images.splice(i,1); afterAttachChange(); };
        d.appendChild(x); il.appendChild(d);
    });
    const dl=$('doc-list'); dl.innerHTML='';
    sel.docs.forEach((a,i)=>{
        const d=document.createElement('div'); d.className='att-doc'; d.textContent='📄 '+a.name; d.title=a.name+' — download';
        d.onclick=()=>downloadAsset(a);
        const x=document.createElement('button'); x.className='att-x'; x.textContent='×';
        x.onclick=ev=>{ ev.stopPropagation(); sel.docs.splice(i,1); afterAttachChange(); };
        d.appendChild(x); dl.appendChild(d);
    });
}
function afterAttachChange(){
    renderAttachLists();
    if(State.selNode===State.openNode){
        Engine.buildAttachments();
        if(quickOn) renderContentLists(State.openNode,'q');
    }
    D.markDirty();
}

function bindFiles(){
    $('img-in').addEventListener('change', e=>{
        [...e.target.files].forEach(f=>{
            const r=new FileReader();
            r.onload=()=>{ const im=new Image();
                im.onload=async()=>{
                    const ref=await D.saveAsset({name:f.name, dataURL:r.result, aspect:im.width/im.height});
                    State.selNode.images.push(ref); afterAttachChange();
                };
                im.src=r.result; };
            r.readAsDataURL(f);
        });
        e.target.value='';
    });
    $('doc-in').addEventListener('change', e=>{
        [...e.target.files].forEach(f=>{
            const r=new FileReader();
            r.onload=async()=>{
                const ref=await D.saveAsset({name:f.name, dataURL:r.result, size:f.size});
                State.selNode.docs.push(ref); afterAttachChange();
            };
            r.readAsDataURL(f);
        });
        e.target.value='';
    });
    $('file-in').addEventListener('change', async e=>{
        const f=e.target.files[0]; if(!f) return;
        const r=new FileReader();
        r.onload=async()=>{ try{
                const o=JSON.parse(r.result);
                const root=D.fromStd(o.root||o);
                const nb={id:null, name:o.name||('Imported '+State.notebooks.length), root};
                if(State.serverOn){
                    try{ const c=await D.api('notebooks',{method:'POST',body:JSON.stringify({name:nb.name, root:D.toStd(root)})});
                         nb.id=c.id; }catch(err){}
                }
                State.notebooks.push(nb);
                refreshNbSelect(State.notebooks.length-1);
                await switchNotebook(State.notebooks.length-1);
                toast('Notebook loaded: '+nb.name);
            }catch(err){ toast('Invalid file.'); } };
        r.readAsText(f); e.target.value='';
    });
}

/* dolu alt atom listesi + solucan delikleri */
function renderSublist(){
    const sel=State.selNode;
    const el=$('sublist');
    const base=D.address(sel);
    const rows=D.filledSlots(sel);
    let html='<h4>// Filled Child Atoms ('+rows.length+'/'+SLOT_COUNT+')</h4>'+
        (rows.length?'':'<p class="empty">Empty so far — click a dim slot tip in the 3D view.</p>');
    el.innerHTML=html;
    rows.forEach(i=>{
        const c=sel.slots[i];
        const row=document.createElement('div'); row.className='sub';
        const num=document.createElement('span'); num.className='num'; num.textContent=base+'.'+(i+1);
        const nm=document.createElement('span'); nm.className='nm';
        nm.textContent=c.title||'untitled';
        nm.onclick=()=>{ State.selNode=c; updatePanel(); };
        const cnt=document.createElement('span'); cnt.className='cnt';
        cnt.textContent=(D.filledSlots(c).length?D.filledSlots(c).length+'↓ ':'')+
            (c.images.length?'📷'+c.images.length+' ':'')+(c.docs.length?'📄'+c.docs.length:'')+
            (c.links.length?' 🕳'+c.links.length:'');
        const go=document.createElement('span'); go.className='go'; go.textContent='go →';
        go.onclick=()=>{ State.selNode=c; Engine.buildView(c); Controls.flyTo(c); };
        const del=document.createElement('span'); del.className='del'; del.textContent='×'; del.title='Delete';
        del.onclick=()=>{
            if(del.textContent==='×'){ del.textContent='sure?'; setTimeout(()=>del.textContent='×',2000); return; }
            D.pushUndo();
            delete sel.slots[i];
            D.rebuildIndex();
            if(D.inTreeOf(State.openNode,c)) Engine.buildView(sel); else Engine.buildView(State.openNode);
            D.markDirty(); toast('Deleted: '+base+'.'+(i+1)+' (Ctrl+Z undoes)');
        };
        row.append(num,nm,cnt,go,del); el.appendChild(row);
    });
    /* bu düğümün bağlantıları (solucan delikleri — defterler arası dahil) */
    if(sel.links.length){
        const h=document.createElement('h4'); h.textContent='// Links 🕳 ⇄ 🧠'; h.style.marginTop='6px';
        el.appendChild(h);
        sel.links.forEach(id=>{
            const r=D.resolveLink(id); if(!r) return;
            const t=r.node, cross=r.nbIndex!==State.nbIndex;
            const row=document.createElement('div'); row.className='sub';
            if(cross){
                const nb=document.createElement('span'); nb.className='xnb';
                nb.textContent='🧠 '+State.notebooks[r.nbIndex].name;
                nb.title=State.notebooks[r.nbIndex].name;
                row.appendChild(nb);
            }
            const num=document.createElement('span'); num.className='num'; num.textContent=D.address(t);
            const nm=document.createElement('span'); nm.className='nm'; nm.textContent=t.title||'untitled';
            const tp=document.createElement('span'); tp.className='tp'; tp.textContent='teleport ⇄';
            tp.onclick=async()=>{
                if(cross) await switchNotebook(r.nbIndex);
                State.selNode=t; Engine.buildView(t); Controls.spawnNear(t); updatePanel();
                toast(cross?('🧠 Teleported → '+State.notebooks[r.nbIndex].name+' · '+D.address(t))
                           :('🕳 Teleported → '+D.address(t)));
            };
            const del=document.createElement('span'); del.className='del'; del.textContent='×';
            del.onclick=()=>{ D.unlink(sel,id); Engine.buildView(State.openNode); updatePanel(); };
            row.append(num,nm,tp,del); el.appendChild(row);
        });
    }
}
let subTimer=null;
function renderSublistThrottled(){ clearTimeout(subTimer); subTimer=setTimeout(renderSublist,300); }

/* ============================================================ GLOBAL ARAMA */
function bindSearch(){
    const inp=$('search-in'), res=$('search-res');
    let t=null;
    inp.addEventListener('input',()=>{
        clearTimeout(t);
        t=setTimeout(()=>{
            const hits=D.search(inp.value);
            res.innerHTML='';
            if(inp.value.trim() && !hits.length) res.innerHTML='<p class="empty" style="font-size:10px;color:var(--faint)">no results</p>';
            hits.forEach(h=>{
                const row=document.createElement('div'); row.className='sr';
                const num=document.createElement('span'); num.className='num'; num.textContent=D.address(h.node);
                const tt=document.createElement('span'); tt.className='t'; tt.textContent=h.node.title||'untitled';
                const sn=document.createElement('span'); sn.className='snip'; sn.textContent=h.snip;
                row.append(num,tt,sn);
                row.onclick=()=>{ /* sonuca uç: kamera otomatik o düğüme gider */
                    State.selNode=h.node;
                    Engine.buildView(h.node);
                    if(State.mode==='focus') Controls.focusOn(h.node,false);
                    else Controls.spawnNear(h.node);
                    updatePanel();
                };
                res.appendChild(row);
            });
        },250);
    });
}

/* ============================================================ ZAMAN TÜNELİ */
function bindTunnel(){
    $('btn-tunnel').onclick=openTunnel;
    $('tunnel-close').onclick=()=>$('tunnel').classList.remove('open');
    $('tunnel-snap').onclick=async()=>{
        try{ await D.snapshotNow(); toast('⏳ Current universe snapshotted.'); openTunnel(); }
        catch(e){ toast('Versioning requires the server.'); }
    };
    $('tunnel-undo').onclick=()=>{ const r=D.undo(); afterTimeShift(r,'↶ Undone'); };
    $('tunnel-redo').onclick=()=>{ const r=D.redo(); afterTimeShift(r,'↷ Redone'); };
}
function afterTimeShift(root,msg){
    if(!root){ toast('No other moment to go to.'); return; }
    const addr=State.openNode?D.address(State.openNode):'0';
    const node=D.nodeByAddress(root, addr);
    State.selNode=node; Engine.buildView(node); updatePanel();
    toast(msg);
}
async function openTunnel(){
    $('tunnel').classList.add('open');
    const list=$('tunnel-list');
    list.innerHTML='<p style="font-size:11px;color:#57606f">loading…</p>';
    const vers=await D.listVersions();
    list.innerHTML=vers.length?'':'<p style="font-size:11px;color:#57606f">'+
        (State.serverOn?'No versions yet — start with "Snapshot Now". (Auto: every 10 min)':'Server off: only in-session Ctrl+Z/Y is available.')+'</p>';
    vers.slice().reverse().forEach(v=>{
        const row=document.createElement('div'); row.className='ver';
        const ts=document.createElement('span'); ts.className='ts';
        ts.textContent='🌌 '+new Date(v.ts).toLocaleString();
        const b=document.createElement('button'); b.textContent='RETURN TO THIS UNIVERSE';
        b.onclick=async()=>{
            try{
                const full=await D.getVersion(v.i);
                const root=D.restoreRoot(full.root);
                State.selNode=root; Engine.buildView(root); Controls.spawnNear(root);
                $('tunnel').classList.remove('open');
                toast('⏳ Returned to the universe of '+new Date(v.ts).toLocaleString()+' (Ctrl+Z: back).');
            }catch(e){ toast('Failed to load version.'); }
        };
        row.append(ts,b); list.appendChild(row);
    });
}

/* ================================================= KLAVYE: UNDO/REDO + ESC */
function bindKeys(){
    window.addEventListener('keydown', e=>{
        const a=document.activeElement;
        const inField=a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable);
        if(e.key==='Escape'){
            endLinkMode();
            $('twod').classList.remove('open');
            $('tunnel').classList.remove('open');
            $('xlink').classList.remove('open');
            if(brainOn) closeBrain();
        }
        if(inField) return;
        if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z' && !e.shiftKey){
            e.preventDefault(); afterTimeShift(D.undo(),'↶ Undone');
        }
        if((e.ctrlKey||e.metaKey) && (e.key.toLowerCase()==='y' || (e.shiftKey&&e.key.toLowerCase()==='z'))){
            e.preventDefault(); afterTimeShift(D.redo(),'↷ Redone');
        }
        /* frustum culling aç/kapat (performans hata ayıklama) */
        if(!e.ctrlKey && !e.metaKey && e.key.toLowerCase()==='k'){
            const on=Engine.toggleCulling();
            toast(on?'✂️ Culling ON — off-screen labels/attachments skipped':'Culling OFF — everything drawn');
        }
    });
}

/* ============================================== DEFTER SEÇİCİ + BUTONLAR */
export function refreshNbSelect(sel){
    const s=$('nb-select'); s.innerHTML='';
    State.notebooks.forEach((nb,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=nb.name; s.appendChild(o); });
    if(sel!=null) s.value=sel;
}
export async function switchNotebook(i){
    State.nbIndex=i;
    $('nb-select').value=i;
    const nb=State.notebooks[i];
    await D.ensureRoot(nb);
    D.rebuildIndex();
    D.clearSearch(); $('search-in').value=''; $('search-res').innerHTML='';
    State.selNode=nb.root;
    Engine.buildView(nb.root);
    Controls.spawnNear(nb.root);
}
function bindButtons(){
    $('nb-select').addEventListener('change', e=>switchNotebook(+e.target.value));
    $('nb-new').onclick=async()=>{
        const nb=await D.createNotebook('Notebook '+(State.notebooks.length+1));
        refreshNbSelect(State.notebooks.length-1);
        await switchNotebook(State.notebooks.length-1);
        toast('New clean notebook: '+nb.name);
    };
    $('nb-rename').onclick=renameNotebook;
    $('btn-home').onclick=()=>{ const r=D.currentRoot(); if(!r) return;
        State.selNode=r; Engine.buildView(r); Controls.spawnNear(r); };
    $('btn-up').onclick=()=>{
        if(State.openNode && State.openNode.parent){
            const p=State.openNode.parent;
            State.selNode=p; Engine.buildView(p); Controls.flyTo(p);
        } else toast('Already at the main hub.');
    };
    $('btn-share').onclick=shareSubtree;
    $('btn-twod').onclick=openTwod;
    $('btn-topdown').onclick=()=>{
        const url=Engine.exportTopDown(); if(!url) return;
        const a=document.createElement('a'); a.href=url;
        a.download='note-universe-topdown-'+D.address(State.openNode).replace(/\./g,'-')+'.png'; a.click();
        toast('Top-down (orthographic) PNG downloaded.');
    };
    $('btn-export').onclick=exportJSON;
    $('btn-import').onclick=()=>$('file-in').click();
}
function renameNotebook(){
    const s=$('nb-select'), nb=D.currentNb(); if(!nb) return;
    const inp=document.createElement('input');
    inp.value=nb.name; inp.maxLength=60;
    Object.assign(inp.style,{flex:'1',background:'#000',border:'1px dashed #00d2ff',color:'#00d2ff',
        fontFamily:'inherit',fontSize:'11px',padding:'5px',outline:'none',minWidth:'0'});
    s.style.display='none'; s.parentNode.insertBefore(inp,s); inp.focus(); inp.select();
    const done=ok=>{ if(ok&&inp.value.trim()){ nb.name=inp.value.trim(); refreshNbSelect(State.nbIndex); D.markDirty(); }
        inp.remove(); s.style.display=''; };
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter') done(true); if(e.key==='Escape') done(false); });
    inp.addEventListener('blur',()=>done(true));
}

/* ============================================================== PAYLAŞIM */
async function shareSubtree(){
    if(!State.selNode) return;
    if(!State.serverOn){ toast('Sharing needs the backend: `node server.js`. Use ↓ JSON for now.'); return; }
    try{
        const r=await D.api('share',{method:'POST',
            body:JSON.stringify({name:State.selNode.title||D.address(State.selNode), root:D.toStd(State.selNode), focus:'0'})});
        const url=location.origin+r.url+'&depth='+State.renderDepth;
        try{ await navigator.clipboard.writeText(url); toast('Share link copied to clipboard 🔗'); }
        catch(e){ toast(url); }
    }catch(e){ toast('Share failed — server unreachable.'); }
}

/* ========================================= JSON dışa aktarım (gömme modu) */
async function exportJSON(){
    const nb=D.currentNb(); if(!nb||!nb.root) return;
    toast('Exporting… (embedding assets)');
    const std=D.toStd(nb.root);
    await embedAssets(std); // taşınabilirlik: dosya kendi kendine yeter
    const blob=new Blob([JSON.stringify({name:nb.name, root:std},null,1)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=nb.name.replace(/\s+/g,'-')+'.json'; a.click();
    toast('Notebook downloaded (standard schema + embedded assets).');
}
async function embedAssets(std){
    for(const list of [std.images||[], std.docs||[]]){
        for(const a of list){
            const rec=await D.resolveAsset(a.assetId);
            if(rec) a.dataURL=rec.dataURL;
        }
    }
    for(const c of (std.children||[])) await embedAssets(c);
}

/* ============================================ 2B KÜME–ALT KÜME İNDİRGEMESİ ==
   Her not bir küme dairesidir; alt notları dairenin İÇİNDE alt küme daireleri
   olarak yerleşir (iç içe kümeler). Tıklanan küme yeniden köklendirir.
   ========================================================================== */
let twodRoot=null, twodPlaced=[];
function bindTwod(){
    $('twod-close').onclick=()=>$('twod').classList.remove('open');
    $('twod-up').onclick=()=>{ if(twodRoot&&twodRoot.parent){ twodRoot=twodRoot.parent; drawTwod(); } };
    $('twod-open3d').onclick=()=>{
        $('twod').classList.remove('open');
        State.selNode=twodRoot; Engine.buildView(twodRoot); Controls.flyTo(twodRoot);
    };
    $('twod-png').onclick=()=>{
        const a=document.createElement('a');
        a.href=$('twod-cv').toDataURL('image/png');
        a.download='not-evreni-2d-'+D.address(twodRoot).replace(/\./g,'-')+'.png';
        a.click(); toast('2D cluster map PNG downloaded.');
    };
    $('twod-cv').addEventListener('click', e=>{
        const r=$('twod-cv').getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
        /* iç içe daireler: noktayı kapsayan EN KÜÇÜK (en derin) küme seçilir */
        let best=null;
        for(const p of twodPlaced)
            if(Math.hypot(x-p.x,y-p.y)<=p.r && (!best || p.r<best.r)) best=p;
        if(best && best.node!==twodRoot){ twodRoot=best.node; State.selNode=best.node; drawTwod(); }
    });
}
function openTwod(){ twodRoot=State.openNode; $('twod').classList.add('open'); drawTwod(); }
function drawTwod(){
    const tcv=$('twod-cv'), tctx=tcv.getContext('2d');
    const dpr=Math.min(devicePixelRatio,2);
    tcv.width=innerWidth*dpr; tcv.height=innerHeight*dpr;
    tcv.style.width=innerWidth+'px'; tcv.style.height=innerHeight+'px';
    tctx.setTransform(dpr,0,0,dpr,0,0);
    const light2d=themeIsLight();
    tctx.fillStyle=light2d?'#eef1f7':'#020208'; tctx.fillRect(0,0,innerWidth,innerHeight);
    $('twod-title').textContent='🗺 '+D.address(twodRoot)+' — '+(twodRoot.title||'untitled')+' · click a cluster: re-root';

    const cx=innerWidth/2, cy=innerHeight/2;
    const R0=Math.min(innerWidth,innerHeight)*0.42, MAXD=4, MAXN=400;
    twodPlaced=[];
    const leafCache=new Map();
    function leaves(n,d){
        if(d>=MAXD) return 1;
        if(leafCache.has(n)) return leafCache.get(n);
        const f=D.filledSlots(n);
        const v=f.length?f.reduce((s,i)=>s+leaves(n.slots[i],d+1),0):1;
        leafCache.set(n,v); return v;
    }
    let count=0;
    (function place(n,x,y,R,d){
        if(count++>MAXN || R<3) return;
        const col=d===0?'#ff4757':'#'+Engine.colorOf(n).getHexString();
        /* küme dairesi: hafif dolgu + renkli çember */
        tctx.globalAlpha=0.09; tctx.fillStyle=col;
        tctx.beginPath(); tctx.arc(x,y,R,0,Math.PI*2); tctx.fill();
        tctx.globalAlpha=Math.max(0.9-d*0.15,0.4);
        tctx.strokeStyle=col; tctx.lineWidth=Math.max(2.4-d*0.6,0.8);
        tctx.beginPath(); tctx.arc(x,y,R,0,Math.PI*2); tctx.stroke();
        tctx.globalAlpha=1;
        if(n===State.selNode){ tctx.strokeStyle='#fff'; tctx.lineWidth=1.5; tctx.setLineDash([4,4]);
            tctx.beginPath(); tctx.arc(x,y,R+5,0,Math.PI*2); tctx.stroke(); tctx.setLineDash([]); }
        twodPlaced.push({x,y,r:R,node:n});
        /* etiket: kümenin üst iç kenarında */
        if(R>=22){
            tctx.fillStyle=d===0?(light2d?'#b02a3a':'#ff9aa5'):(light2d?'#4a5568':'#a4b0be');
            tctx.font=(d===0?'bold 13px':(d===1?'11px':'10px'))+' Courier New';
            tctx.textAlign='center';
            const t=n.title||D.address(n);
            tctx.fillText(t.length>22?t.slice(0,21)+'…':t, x, y-R+14);
        }
        const f=D.filledSlots(n);
        if(!f.length) return;
        if(d>=MAXD){ /* derinlik sınırı: kalan alt küme sayısını göster */
            tctx.fillStyle=light2d?'#8b95a6':'#57606f'; tctx.font='9px Courier New'; tctx.textAlign='center';
            tctx.fillText('+'+f.length, x, y+4);
            return;
        }
        const total=f.reduce((s,i)=>s+leaves(n.slots[i],d+1),0);
        if(f.length===1){ /* tek alt küme: merkezde büyük daire */
            place(n.slots[f[0]], x, y+R*0.12, R*0.62, d+1);
            return;
        }
        /* alt kümeler ebeveyn dairesinin içinde bir halkaya dizilir;
           yarıçap ağırlığı = alt ağacın yaprak sayısı (√ ile alan orantılı) */
        const k=f.length, rho=R*0.58;
        const rFit=Math.min(rho*Math.sin(Math.PI/k)*0.92, R-rho-2);
        f.forEach((i,j)=>{
            const w=Math.sqrt(leaves(n.slots[i],d+1)/total);
            const r=Math.max(Math.min(R*0.52*w, rFit), 3.5);
            const a=-Math.PI/2 + j*2*Math.PI/k + d*0.5;
            place(n.slots[i], x+Math.cos(a)*rho, y+Math.sin(a)*rho, r, d+1);
        });
    })(twodRoot,cx,cy,R0,0);
    tctx.fillStyle=light2d?'#8b95a6':'#3d4452'; tctx.font='10px Courier New'; tctx.textAlign='left';
    tctx.fillText('3D Quantum Note Universe · cluster–subcluster reduction · '+new Date().toLocaleDateString(),16,innerHeight-16);
}

/* ============================== DEFTERLER ARASI BAĞLANTI SEÇİCİ (Obsidian) */
function bindXlink(){
    $('xlink-close').onclick=()=>$('xlink').classList.remove('open');
    let t=null;
    $('xlink-in').addEventListener('input',()=>{ clearTimeout(t); t=setTimeout(renderXlinkResults,200); });
}
async function openXlink(){
    if(!State.selNode) return;
    await D.ensureAllRoots();
    $('xlink-src').textContent='Source: '+D.address(State.selNode)+' — '+(State.selNode.title||'untitled')+
        ' ('+D.currentNb().name+') · pick a target; a bidirectional wormhole is created';
    $('xlink-in').value='';
    $('xlink').classList.add('open');
    renderXlinkResults();
    $('xlink-in').focus();
}
function renderXlinkResults(){
    const q=$('xlink-in').value.trim().toLowerCase();
    const res=$('xlink-res'); res.innerHTML='';
    const sel=State.selNode;
    let count=0;
    State.notebooks.forEach((nb,i)=>{
        if(!nb.root || count>=40) return;
        (function walk(n){
            if(count>=40) return;
            const title=(n.title||'').toLowerCase();
            if(n!==sel && (!q || title.includes(q)) && (q || n.parent==null || D.filledSlots(n).length)){
                /* boş sorguda gürültüyü kısmak için kök + dallanan düğümler önce */
                const row=document.createElement('div'); row.className='xr';
                const bn=document.createElement('span'); bn.className='nb'; bn.textContent=nb.name;
                const num=document.createElement('span'); num.className='num'; num.textContent=D.address(n);
                const tt=document.createElement('span'); tt.className='t'; tt.textContent=n.title||'untitled';
                row.append(bn,num,tt);
                row.onclick=()=>{
                    if(D.linkNodesX(sel, n, nb)){
                        toast('🧠 Linked: '+(sel.title||D.address(sel))+' ⇄ '+(n.title||D.address(n))+
                              (nb!==D.currentNb()?' ('+nb.name+')':''));
                        Engine.buildView(State.openNode); updatePanel();
                    }
                    $('xlink').classList.remove('open');
                };
                res.appendChild(row); count++;
            }
            D.filledSlots(n).forEach(k=>walk(n.slots[k]));
        })(nb.root);
    });
    if(!count) res.innerHTML='<p class="empty" style="font-size:11px;color:var(--faint)">no matching notes</p>';
}

/* ========================================== BEYİN GRAFİĞİ (Obsidian graph) ==
   Tüm defterler tek kuvvet-yönelimli grafikte: düğüm rengi = defter,
   soluk kenar = ağaç bağı, mor = solucan deliği, macenta kesikli =
   defterler arası köprü. Tıkla → o deftere geç ve düğüme uç.            */
let brainOn=false, bG=null, bView={x:0,y:0,s:1}, bDrag=null, bHover=-1, bRAF=0, bIter=0;
let bDirty=true, bSearch='', bMatches=new Set();
const nbColor=i=>'#'+PALETTE[i%PALETTE.length].toString(16).padStart(6,'0');
function bindBrain(){
    $('btn-brain').onclick=openBrain;
    $('brain-close').onclick=closeBrain;
    /* beyin içi arama: eşleşenler parlar, diğerleri söner; Enter → ilkine git */
    let bt=null;
    $('brain-in').addEventListener('input',()=>{
        clearTimeout(bt);
        bt=setTimeout(()=>{
            bSearch=$('brain-in').value.trim().toLowerCase();
            bMatches.clear();
            if(bSearch && bG) bG.nodes.forEach((n,i)=>{
                if((n.node.title||'').toLowerCase().includes(bSearch) ||
                   stripHtml(n.node.html).toLowerCase().includes(bSearch)) bMatches.add(i);
            });
            bDirty=true;
        },200);
    });
    $('brain-in').addEventListener('keydown',e=>{
        if(e.key==='Enter' && bMatches.size) gotoBrainNode([...bMatches][0]);
        if(e.key==='Escape') $('brain-in').blur();
    });
    const cv=$('brain-cv');
    cv.addEventListener('wheel',e=>{
        e.preventDefault();
        const k=Math.exp(-e.deltaY*0.0012), s2=Math.min(Math.max(bView.s*k,0.15),6);
        /* imlece doğru yakınlaş */
        bView.x=e.clientX-(e.clientX-bView.x)*(s2/bView.s);
        bView.y=e.clientY-(e.clientY-bView.y)*(s2/bView.s);
        bView.s=s2; bDirty=true;
    },{passive:false});
    cv.addEventListener('mousedown',e=>{ bDrag={x:e.clientX,y:e.clientY,moved:false}; cv.classList.add('dragging'); });
    window.addEventListener('mousemove',e=>{
        if(!brainOn) return;
        if(bDrag){
            if(Math.hypot(e.clientX-bDrag.x,e.clientY-bDrag.y)>4) bDrag.moved=true;
            bView.x+=e.movementX; bView.y+=e.movementY; bDirty=true;
        } else { const h=pickBrain(e); if(h!==bHover){ bHover=h; bDirty=true; } }
    });
    window.addEventListener('mouseup',e=>{
        if(!brainOn) return;
        $('brain-cv').classList.remove('dragging');
        if(bDrag && !bDrag.moved){ const i=pickBrain(e); if(i>=0) gotoBrainNode(i); }
        bDrag=null;
    });
}
async function openBrain(){
    toast('🧠 Building the brain network…');
    await D.ensureAllRoots();
    bG=D.brainGraph();
    if(bG.capped) toast('Graph limited to the first '+bG.nodes.length+' nodes.');
    /* başlangıç: her defter çember üzerinde bir küme merkezi + saçılım */
    const K=Math.max(State.notebooks.length,1), spread=K>1?280:0;
    bG.anchors=[];
    for(let i=0;i<K;i++){ const a=i/K*Math.PI*2;
        bG.anchors.push({x:Math.cos(a)*spread, y:Math.sin(a)*spread}); }
    bG.nodes.forEach(n=>{
        const c=bG.anchors[n.nbIndex]||{x:0,y:0}, h=hashStr(n.node.id);
        n.x=c.x+((h%1000)/1000-0.5)*240;
        n.y=c.y+(((h/1000|0)%1000)/1000-0.5)*240;
        n.vx=0; n.vy=0;
    });
    brainOn=true; bHover=-1; bIter=REDUCED?40:170;
    bSearch=''; bMatches.clear(); $('brain-in').value='';
    bView={x:innerWidth/2, y:innerHeight/2, s:1};
    $('brain').classList.add('open');
    cancelAnimationFrame(bRAF);
    (function loop(){
        if(!brainOn) return;
        /* performans: yerleşim bitince yalnız etkileşimde yeniden çiz */
        if(bIter>0){ stepBrain(bIter>90?3:1); bIter--; drawBrain(); }
        else if(bDirty){ drawBrain(); bDirty=false; }
        bRAF=requestAnimationFrame(loop);
    })();
}
function closeBrain(){ brainOn=false; $('brain').classList.remove('open'); cancelAnimationFrame(bRAF); }
function stepBrain(steps){
    const N=bG.nodes, E=bG.edges;
    for(let s=0;s<steps;s++){
        for(let i=0;i<N.length;i++){ const a=N[i]; // itme
            for(let j=i+1;j<N.length;j++){ const b=N[j];
                let dx=a.x-b.x, dy=a.y-b.y, d2=dx*dx+dy*dy;
                if(d2<0.01){ dx=Math.random()-0.5; dy=Math.random()-0.5; d2=1; }
                if(d2>62500) continue;
                const f=760/d2;
                a.vx+=dx*f; a.vy+=dy*f; b.vx-=dx*f; b.vy-=dy*f;
            }
        }
        for(const e of E){ // yaylar: ağaç kısa, ikiz orta, solucan/köprü uzun
            const a=N[e.a], b=N[e.b];
            const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy)||1;
            const rest=e.type==='tree'?44:(e.type==='twin'?95:130);
            const f=(d-rest)*(e.type==='tree'?0.014:(e.type==='twin'?0.010:0.006))/d;
            a.vx+=dx*f; a.vy+=dy*f; b.vx-=dx*f; b.vy-=dy*f;
        }
        for(const n of N){ // küme çekimi + sönümleme
            const c=bG.anchors[n.nbIndex]||{x:0,y:0};
            n.vx+=(c.x-n.x)*0.0022; n.vy+=(c.y-n.y)*0.0022;
            n.vx*=0.82; n.vy*=0.82;
            n.x+=Math.max(-14,Math.min(14,n.vx));
            n.y+=Math.max(-14,Math.min(14,n.vy));
        }
    }
}
function drawBrain(){
    const cv=$('brain-cv'), x=cv.getContext('2d');
    const dpr=Math.min(devicePixelRatio,2);
    if(cv.width!==innerWidth*dpr){ cv.width=innerWidth*dpr; cv.height=innerHeight*dpr;
        cv.style.width=innerWidth+'px'; cv.style.height=innerHeight+'px'; }
    x.setTransform(dpr,0,0,dpr,0,0);
    const light=themeIsLight();
    x.fillStyle=light?'#eef1f7':'#020208'; x.fillRect(0,0,innerWidth,innerHeight);
    x.translate(bView.x,bView.y); x.scale(bView.s,bView.s);
    const N=bG.nodes, searching=bMatches.size>0||bSearch;
    for(const e of bG.edges){ /* kenarlar: BAĞLI kümeler ağaç bağlarından
        belirgin biçimde kalın — ikiz kalınlığı paylaşılan çocuk sayısıyla artar */
        const a=N[e.a], b=N[e.b];
        if(e.type==='tree'){ x.strokeStyle=light?'rgba(70,85,110,0.18)':'rgba(120,130,160,0.16)'; x.lineWidth=0.8/bView.s; x.setLineDash([]); }
        else if(e.type==='worm'){ x.strokeStyle='rgba(125,95,255,0.8)'; x.lineWidth=2.4/bView.s; x.setLineDash([]); }
        else if(e.type==='twin'){ x.strokeStyle=light?'rgba(168,106,0,0.85)':'rgba(255,165,2,0.8)';
            x.lineWidth=(2+0.5*Math.min(e.w||1,6))/bView.s; x.setLineDash([]); }
        else{ x.strokeStyle='rgba(255,95,208,0.85)'; x.lineWidth=2.8/bView.s; x.setLineDash([6/bView.s,5/bView.s]); }
        x.beginPath(); x.moveTo(a.x,a.y); x.lineTo(b.x,b.y); x.stroke();
    }
    x.setLineDash([]);
    N.forEach((n,i)=>{ /* düğümler: renk = defter, derinlikle KÜÇÜLEN boyut */
        const r=(n.isRoot?9:Math.max(7-n.depth*1.4,2.2))+Math.min(n.deg,8)*0.4;
        const match=bMatches.has(i);
        x.globalAlpha=searching&&!match?0.22:1;
        x.fillStyle=nbColor(n.nbIndex);
        x.beginPath(); x.arc(n.x,n.y,r,0,Math.PI*2); x.fill();
        if(match || i===bHover || n.node===State.selNode){
            x.strokeStyle=light?'#141a24':'#fff'; x.lineWidth=1.4/bView.s;
            x.beginPath(); x.arc(n.x,n.y,r+3/bView.s,0,Math.PI*2); x.stroke();
        }
        if(n.isRoot || i===bHover || match || (n.deg>=5 && bView.s>0.5)){
            x.fillStyle=n.isRoot?nbColor(n.nbIndex):(light?'#4a5568':'#a4b0be');
            x.font=(n.isRoot?'bold 13px':'10px')+' Courier New'; x.textAlign='center';
            const t=n.isRoot?State.notebooks[n.nbIndex].name:(n.node.title||D.address(n.node));
            x.fillText(t.length>24?t.slice(0,23)+'…':t, n.x, n.y+r+12/bView.s);
        }
        x.globalAlpha=1;
    });
    x.setTransform(dpr,0,0,dpr,0,0); // gösterge
    x.font='10px Courier New'; x.textAlign='left';
    State.notebooks.forEach((nb,i)=>{
        x.fillStyle=nbColor(i);
        x.fillText('● '+nb.name, 16, innerHeight-34-i*14);
    });
    x.fillStyle=light?'#8b95a6':'#3d4452';
    x.fillText('🧠 '+N.length+' nodes · purple: wormhole · dashed magenta: cross-notebook bridge · amber: twin clusters'+
        (searching?' · '+bMatches.size+' match(es)':''), 16, innerHeight-16);
}
function pickBrain(e){
    if(!bG) return -1;
    const wx=(e.clientX-bView.x)/bView.s, wy=(e.clientY-bView.y)/bView.s;
    let best=-1, bd=Infinity;
    bG.nodes.forEach((n,i)=>{
        const r=(n.isRoot?9:Math.max(7-n.depth*1.4,2.2))+Math.min(n.deg,8)*0.4+6/bView.s;
        const d=Math.hypot(wx-n.x,wy-n.y);
        if(d<r && d<bd){ bd=d; best=i; }
    });
    $('brain-cv').style.cursor=best>=0?'pointer':'grab';
    return best;
}
async function gotoBrainNode(i){
    const rec=bG.nodes[i];
    closeBrain();
    if(rec.nbIndex!==State.nbIndex) await switchNotebook(rec.nbIndex);
    State.selNode=rec.node;
    Engine.buildView(rec.node);
    Controls.spawnNear(rec.node);
    updatePanel();
    toast('🧠 '+State.notebooks[rec.nbIndex].name+' · '+D.address(rec.node)+(rec.node.title?' — '+rec.node.title:''));
}

/* ============================================================== TEMA ======
   Karanlık/aydınlık: CSS değişkenleri + Engine sahne renkleri + açık
   katmanların yeniden çizimi. Tercih localStorage'da; ilk değer sistemden. */
function themeIsLight(){ return document.documentElement.dataset.theme==='light'; }
function setTheme(light, silent){
    document.documentElement.dataset.theme=light?'light':'dark';
    try{ localStorage.setItem('nu-theme', light?'light':'dark'); }catch(e){}
    Engine.applyTheme(light);
    if($('twod').classList.contains('open')) drawTwod();
    if(brainOn) bDirty=true;
    if(!silent) toast(light?'☀️ Light theme':'🌙 Dark theme');
}
function bindTheme(){
    let light=false;
    try{
        const saved=localStorage.getItem('nu-theme');
        light = saved ? saved==='light' : matchMedia('(prefers-color-scheme: light)').matches;
    }catch(e){}
    setTheme(light, true);
    $('btn-theme').onclick=()=>setTheme(!themeIsLight());
}

/* ===================================== CANLI MCP SENKRONU (Claude yazarken) =
   Sunucudaki updatedAt damgaları 6 sn'de bir karşılaştırılır; yalnız sekme
   görünürken, bekleyen yerel kayıt yokken ve kullanıcı yazmıyorken çalışır —
   işlemciyi yormaz. Değişen defter açıksa görünüm yerinde tazelenir.        */
function startMcpSync(){
    if(!State.serverOn || !State.user) return;
    setInterval(mcpSyncTick, 6000);
}
async function mcpSyncTick(){
    if(document.hidden || !State.serverOn || !State.user) return;
    if(D.hasPendingSave()) return;
    const a=document.activeElement;
    if(a && (a.tagName==='INPUT' || a.tagName==='TEXTAREA' || a.isContentEditable)) return;
    try{
        const list=await D.api('notebooks');
        let selChanged=false;
        for(const m of list){
            const nb=State.notebooks.find(n=>n.id===m.id);
            if(!nb){
                State.notebooks.push({id:m.id, name:m.name, root:null, updatedAt:m.updatedAt||0});
                refreshNbSelect(State.nbIndex);
                toast('🤖 New notebook via MCP: '+m.name);
                continue;
            }
            if(!nb.updatedAt){ nb.updatedAt=m.updatedAt||0; continue; }
            if((m.updatedAt||0)>nb.updatedAt){
                nb.updatedAt=m.updatedAt; nb.name=m.name;
                if(nb===D.currentNb()){
                    const openAddr=State.openNode?D.address(State.openNode):'0';
                    const full=await D.api('notebooks/'+nb.id);
                    nb.root=D.fromStd(full.root);
                    D.rebuildIndex();
                    const node=D.nodeByAddress(nb.root, openAddr);
                    State.selNode=node; Engine.buildView(node);
                    toast('🤖 Notebook updated live (MCP)');
                } else nb.root=null; /* sonraki geçişte taze yüklenir */
                selChanged=true;
            }
        }
        if(selChanged) refreshNbSelect(State.nbIndex);
    }catch(e){}
}

/* ============================================================ TOAST + TIP */
let toastTimer=null;
export function toast(m){
    const t=$('toast'); t.textContent=m; t.style.opacity=1;
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.style.opacity=0,2600);
}
function tipShow(t){ tip.style.display=t?'block':'none'; tip.textContent=t||''; }
function tipMove(e){ tip.style.left=(e.clientX+14)+'px'; tip.style.top=(e.clientY+14)+'px'; }
