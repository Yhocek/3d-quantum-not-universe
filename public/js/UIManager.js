/* =============================================================================
   UIManager — paneller, hızlı menü, YAKLAŞ butonu, global arama, zaman tüneli,
   kuantum bağlantı arayüzü, 2B indirgeme, paylaşım, URL durumu, içe/dışa aktarım
   ============================================================================= */
import { SLOT_COUNT, REDUCED, genId, sanitizeHtml } from './config.js';
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
                                  $('auth').classList.contains('show'));
    D.onSaveState(setSaveDot);
    setSaveDot(State.serverOn ? 'saved' : 'off'); // probe UI'dan önce koştu; ilk durumu şimdi bas

    bindPanel(); bindQuick(); bindCard(); bindSearch(); bindModes(); bindAuth();
    bindButtons(); bindTunnel(); bindTwod(); bindFiles(); bindKeys();
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
        toast('Yerel mod: verilerin bu tarayıcıda (IndexedDB) saklanır.');
    };
    $('btn-logout').onclick=async()=>{ await D.logout(); location.reload(); };
    refreshUserChip();
}
function setAuthMode(m){
    authMode=m;
    $('auth-tab-login').classList.toggle('on', m==='login');
    $('auth-tab-register').classList.toggle('on', m==='register');
    $('auth-submit').textContent = m==='login' ? 'GİRİŞ YAP' : 'HESAP OLUŞTUR';
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
    el.textContent={saved:'● senkron', saving:'● kaydediliyor…', dirty:'● kaydedilecek',
                    off:'○ çevrimdışı — yerel kayıt aktif (IndexedDB)'}[s];
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
    toast(m==='flight' ? '🚀 Uçuş modu: WASD ile serbest uç'
                       : '🎯 Odak modu: atoma tıkla → yumuşak yaklaş, sürükle → yörüngede dön');
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
                    txt='🕳 '+D.address(a.node)+(a.node.title?' — '+a.node.title:'')+' · tıkla, ışınlan';
                }else{
                    txt=D.address(a.node)+(a.node.title?' — '+a.node.title:' — isimsiz');
                    if(a.kind!=='open') cardShow(a.node, a.pos);
                }
            }
        } else if(h.object===slotsMesh){
            hS=h.instanceId;
            const d=Engine.slotInst[hS];
            if(d && State.openNode) txt=D.address(State.openNode)+'.'+(d.slotIndex+1)+' — boş yuva · tıkla, not doğur';
        } else if(h.object.isSprite){
            txt=h.object.userData.type==='doc' ? h.object.userData.att.name+' · tıkla, indir' : h.object.userData.att.name;
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
                toast('🕳 Solucan deliği kuruldu: '+D.address(State.linkFrom)+' ⇄ '+D.address(a.node));
            }
            endLinkMode();
            Engine.buildView(State.openNode);
            return;
        }
        if(a.kind==='portal'){ // ışınlan!
            const t=a.node;
            toast('🕳 Işınlanıyorsun → '+D.address(t));
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
        toast('Not doğdu: '+D.address(c));
        $('title-in').focus();
    } else if(h.object.isSprite && h.object.userData.type==='doc'){
        downloadAsset(h.object.userData.att);
    }
}
async function downloadAsset(att){
    const rec=await D.resolveAsset(att.assetId);
    if(!rec){ toast('Dosya bulunamadı (çevrimdışı olabilir).'); return; }
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
        toast('Seçildi: '+D.address(cardNode)+' — sağ panelden düzenle');
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
    subcard.querySelector('.sc-title').textContent=node.title||'isimsiz';
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
            const b=elMk('span','sc-item','.'+(i+1)+' '+(c.title||'isimsiz'));
            b.title=D.address(c)+' — seç';
            b.onclick=()=>{ State.selNode=c; updatePanel(); };
            notesEl.appendChild(b);
        });
        if(kids.length>4) notesEl.appendChild(elMk('span','sc-more','+'+(kids.length-4)));
    } else notesEl.appendChild(elMk('span','sc-empty','📝 alt not yok'));
    /* 📄 belgeler */
    docsEl.innerHTML='';
    if(node.docs.length){
        docsEl.appendChild(elMk('span','sc-k','📄'));
        node.docs.slice(0,3).forEach(a=>{
            const b=elMk('span','sc-item',a.name);
            b.title=a.name+' — indir';
            b.onclick=()=>downloadAsset(a);
            docsEl.appendChild(b);
        });
        if(node.docs.length>3) docsEl.appendChild(elMk('span','sc-more','+'+(node.docs.length-3)));
    } else docsEl.appendChild(elMk('span','sc-empty','📄 belge yok'));
    /* 📷 görsel küçükleri (assetId'den asenkron) */
    imgsEl.innerHTML='';
    if(node.images.length){
        node.images.slice(0,4).forEach(a=>{
            const im=document.createElement('img'); im.alt=a.name; im.title=a.name;
            D.resolveAsset(a.assetId).then(rec=>{ if(rec) im.src=rec.dataURL; });
            imgsEl.appendChild(im);
        });
        if(node.images.length>4) imgsEl.appendChild(elMk('span','sc-more','+'+(node.images.length-4)));
    } else imgsEl.appendChild(elMk('span','sc-empty','📷 görsel yok'));
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
        $('link-hint').textContent='🕳 '+D.address(State.selNode)+' için hedef atomu seç (ESC: vazgeç)';
        toast('Bağlantı modu: hedef atoma tıkla.');
    };
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
    ttl.textContent=' · '+(sel===State.openNode?'AÇIK KÜME':'seçili'); addrEl.appendChild(ttl);

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
        const d=document.createElement('div'); d.className='att-doc'; d.textContent='📄 '+a.name; d.title=a.name+' — indir';
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
                const nb={id:null, name:o.name||('İçe Aktarılan '+State.notebooks.length), root};
                if(State.serverOn){
                    try{ const c=await D.api('notebooks',{method:'POST',body:JSON.stringify({name:nb.name, root:D.toStd(root)})});
                         nb.id=c.id; }catch(err){}
                }
                State.notebooks.push(nb);
                refreshNbSelect(State.notebooks.length-1);
                await switchNotebook(State.notebooks.length-1);
                toast('Defter yüklendi: '+nb.name);
            }catch(err){ toast('Geçersiz dosya.'); } };
        r.readAsText(f); e.target.value='';
    });
}

/* dolu alt atom listesi + solucan delikleri */
function renderSublist(){
    const sel=State.selNode;
    const el=$('sublist');
    const base=D.address(sel);
    const rows=D.filledSlots(sel);
    let html='<h4>// Dolu Alt Atomlar ('+rows.length+'/'+SLOT_COUNT+')</h4>'+
        (rows.length?'':'<p class="empty">Henüz boş — 3B görünümde sönük bir yuva ucuna tıkla.</p>');
    el.innerHTML=html;
    rows.forEach(i=>{
        const c=sel.slots[i];
        const row=document.createElement('div'); row.className='sub';
        const num=document.createElement('span'); num.className='num'; num.textContent=base+'.'+(i+1);
        const nm=document.createElement('span'); nm.className='nm';
        nm.textContent=c.title||'isimsiz';
        nm.onclick=()=>{ State.selNode=c; updatePanel(); };
        const cnt=document.createElement('span'); cnt.className='cnt';
        cnt.textContent=(D.filledSlots(c).length?D.filledSlots(c).length+'↓ ':'')+
            (c.images.length?'📷'+c.images.length+' ':'')+(c.docs.length?'📄'+c.docs.length:'')+
            (c.links.length?' 🕳'+c.links.length:'');
        const go=document.createElement('span'); go.className='go'; go.textContent='git →';
        go.onclick=()=>{ State.selNode=c; Engine.buildView(c); Controls.flyTo(c); };
        const del=document.createElement('span'); del.className='del'; del.textContent='×'; del.title='Sil';
        del.onclick=()=>{
            if(del.textContent==='×'){ del.textContent='emin?'; setTimeout(()=>del.textContent='×',2000); return; }
            D.pushUndo();
            delete sel.slots[i];
            D.rebuildIndex();
            if(D.inTreeOf(State.openNode,c)) Engine.buildView(sel); else Engine.buildView(State.openNode);
            D.markDirty(); toast('Silindi: '+base+'.'+(i+1)+' (Ctrl+Z geri alır)');
        };
        row.append(num,nm,cnt,go,del); el.appendChild(row);
    });
    /* bu düğümün solucan delikleri */
    if(sel.links.length){
        const h=document.createElement('h4'); h.textContent='// Solucan Delikleri 🕳'; h.style.marginTop='6px';
        el.appendChild(h);
        sel.links.forEach(id=>{
            const t=D.nodeById(id); if(!t) return;
            const row=document.createElement('div'); row.className='sub';
            const num=document.createElement('span'); num.className='num'; num.textContent=D.address(t);
            const nm=document.createElement('span'); nm.className='nm'; nm.textContent=t.title||'isimsiz';
            const tp=document.createElement('span'); tp.className='tp'; tp.textContent='ışınlan ⇄';
            tp.onclick=()=>{ State.selNode=t; Engine.buildView(t); Controls.spawnNear(t); toast('🕳 Işınlandın → '+D.address(t)); };
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
            if(inp.value.trim() && !hits.length) res.innerHTML='<p class="empty" style="font-size:10px;color:#3d4452">sonuç yok</p>';
            hits.forEach(h=>{
                const row=document.createElement('div'); row.className='sr';
                const num=document.createElement('span'); num.className='num'; num.textContent=D.address(h.node);
                const tt=document.createElement('span'); tt.className='t'; tt.textContent=h.node.title||'isimsiz';
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
        try{ await D.snapshotNow(); toast('⏳ Şu anki evren versiyonlandı.'); openTunnel(); }
        catch(e){ toast('Versiyonlama için sunucu gerekli.'); }
    };
    $('tunnel-undo').onclick=()=>{ const r=D.undo(); afterTimeShift(r,'↶ Geri alındı'); };
    $('tunnel-redo').onclick=()=>{ const r=D.redo(); afterTimeShift(r,'↷ İleri alındı'); };
}
function afterTimeShift(root,msg){
    if(!root){ toast('Gidilecek başka an yok.'); return; }
    const addr=State.openNode?D.address(State.openNode):'0';
    const node=D.nodeByAddress(root, addr);
    State.selNode=node; Engine.buildView(node); updatePanel();
    toast(msg);
}
async function openTunnel(){
    $('tunnel').classList.add('open');
    const list=$('tunnel-list');
    list.innerHTML='<p style="font-size:11px;color:#57606f">yükleniyor…</p>';
    const vers=await D.listVersions();
    list.innerHTML=vers.length?'':'<p style="font-size:11px;color:#57606f">'+
        (State.serverOn?'Henüz versiyon yok — "Şimdiyi Versiyonla" ile başla. (Otomatik: her 10dk\'da bir)':'Sunucu kapalı: yalnız oturum içi Ctrl+Z/Y kullanılabilir.')+'</p>';
    vers.slice().reverse().forEach(v=>{
        const row=document.createElement('div'); row.className='ver';
        const ts=document.createElement('span'); ts.className='ts';
        ts.textContent='🌌 '+new Date(v.ts).toLocaleString('tr-TR');
        const b=document.createElement('button'); b.textContent='BU EVRENE DÖN';
        b.onclick=async()=>{
            try{
                const full=await D.getVersion(v.i);
                const root=D.restoreRoot(full.root);
                State.selNode=root; Engine.buildView(root); Controls.spawnNear(root);
                $('tunnel').classList.remove('open');
                toast('⏳ '+new Date(v.ts).toLocaleString('tr-TR')+' evrenine dönüldü (Ctrl+Z: geri).');
            }catch(e){ toast('Versiyon yüklenemedi.'); }
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
        }
        if(inField) return;
        if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z' && !e.shiftKey){
            e.preventDefault(); afterTimeShift(D.undo(),'↶ Geri alındı');
        }
        if((e.ctrlKey||e.metaKey) && (e.key.toLowerCase()==='y' || (e.shiftKey&&e.key.toLowerCase()==='z'))){
            e.preventDefault(); afterTimeShift(D.redo(),'↷ İleri alındı');
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
        const nb=await D.createNotebook('Defter '+(State.notebooks.length+1));
        refreshNbSelect(State.notebooks.length-1);
        await switchNotebook(State.notebooks.length-1);
        toast('Yeni temiz defter: '+nb.name);
    };
    $('nb-rename').onclick=renameNotebook;
    $('btn-home').onclick=()=>{ const r=D.currentRoot(); if(!r) return;
        State.selNode=r; Engine.buildView(r); Controls.spawnNear(r); };
    $('btn-up').onclick=()=>{
        if(State.openNode && State.openNode.parent){
            const p=State.openNode.parent;
            State.selNode=p; Engine.buildView(p); Controls.flyTo(p);
        } else toast('Zaten ana merkezdesin.');
    };
    $('btn-share').onclick=shareSubtree;
    $('btn-twod').onclick=openTwod;
    $('btn-topdown').onclick=()=>{
        const url=Engine.exportTopDown(); if(!url) return;
        const a=document.createElement('a'); a.href=url;
        a.download='not-evreni-ustten-'+D.address(State.openNode).replace(/\./g,'-')+'.png'; a.click();
        toast('Üstten (ortografik) PNG indirildi.');
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
    if(!State.serverOn){ toast('Paylaşım için backend gerekli: `node server.js`. Şimdilik ↓ JSON kullan.'); return; }
    try{
        const r=await D.api('share',{method:'POST',
            body:JSON.stringify({name:State.selNode.title||D.address(State.selNode), root:D.toStd(State.selNode), focus:'0'})});
        const url=location.origin+r.url+'&depth='+State.renderDepth;
        try{ await navigator.clipboard.writeText(url); toast('Paylaşım linki panoya kopyalandı 🔗'); }
        catch(e){ toast(url); }
    }catch(e){ toast('Paylaşım başarısız — sunucuya ulaşılamadı.'); }
}

/* ========================================= JSON dışa aktarım (gömme modu) */
async function exportJSON(){
    const nb=D.currentNb(); if(!nb||!nb.root) return;
    toast('Dışa aktarılıyor… (varlıklar gömülüyor)');
    const std=D.toStd(nb.root);
    await embedAssets(std); // taşınabilirlik: dosya kendi kendine yeter
    const blob=new Blob([JSON.stringify({name:nb.name, root:std},null,1)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=nb.name.replace(/\s+/g,'-')+'.json'; a.click();
    toast('Defter indirildi (standart şema + gömülü varlıklar).');
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

/* ===================================================== 2B RADIAL İNDİRGEME */
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
        a.click(); toast('2B harita PNG indirildi.');
    };
    $('twod-cv').addEventListener('click', e=>{
        const r=$('twod-cv').getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
        for(const p of twodPlaced){
            if(Math.hypot(x-p.x,y-p.y)<p.r+6){
                if(p.node!==twodRoot){ twodRoot=p.node; State.selNode=p.node; drawTwod(); }
                return;
            }
        }
    });
}
function openTwod(){ twodRoot=State.openNode; $('twod').classList.add('open'); drawTwod(); }
function drawTwod(){
    const tcv=$('twod-cv'), tctx=tcv.getContext('2d');
    const dpr=Math.min(devicePixelRatio,2);
    tcv.width=innerWidth*dpr; tcv.height=innerHeight*dpr;
    tcv.style.width=innerWidth+'px'; tcv.style.height=innerHeight+'px';
    tctx.setTransform(dpr,0,0,dpr,0,0);
    tctx.fillStyle='#020208'; tctx.fillRect(0,0,innerWidth,innerHeight);
    $('twod-title').textContent='🗺 '+D.address(twodRoot)+' — '+(twodRoot.title||'isimsiz')+' · düğüme tıkla: yeniden köklendir';

    const cx=innerWidth/2, cy=innerHeight/2;
    const RING=Math.min(innerWidth,innerHeight)/9, MAXD=4, MAXN=400;
    twodPlaced=[];
    const leafCache=new Map();
    function leaves(n,d){
        if(d>=MAXD) return 1;
        if(leafCache.has(n)) return leafCache.get(n);
        const f=D.filledSlots(n);
        const v=f.length?f.reduce((s,i)=>s+leaves(n.slots[i],d+1),0):1;
        leafCache.set(n,v); return v;
    }
    tctx.setLineDash([4,6]); tctx.strokeStyle='#12141f';
    for(let d=1;d<=MAXD;d++){ tctx.beginPath(); tctx.arc(cx,cy,d*RING,0,Math.PI*2); tctx.stroke(); }
    tctx.setLineDash([]);
    let count=0;
    (function place(n,a0,a1,d,px,py){
        if(count++>MAXN) return;
        const a=(a0+a1)/2, r=d*RING;
        const x=cx+Math.cos(a)*r, y=cy+Math.sin(a)*r;
        if(d>0){
            tctx.strokeStyle='rgba(120,130,160,'+(0.55/d)+')';
            tctx.lineWidth=Math.max(2.2-d*0.5,0.6);
            tctx.beginPath(); tctx.moveTo(px,py); tctx.lineTo(x,y); tctx.stroke();
        }
        const nr=Math.max(15-d*4,4);
        tctx.fillStyle=d===0?'#ff4757':'#'+Engine.colorOf(n).getHexString();
        tctx.beginPath(); tctx.arc(x,y,nr,0,Math.PI*2); tctx.fill();
        if(n===State.selNode){ tctx.strokeStyle='#fff'; tctx.lineWidth=1.5; tctx.setLineDash([3,3]);
            tctx.beginPath(); tctx.arc(x,y,nr+4,0,Math.PI*2); tctx.stroke(); tctx.setLineDash([]); }
        twodPlaced.push({x,y,r:nr,node:n});
        if(d<=2){
            tctx.fillStyle=d===0?'#ff9aa5':'#a4b0be';
            tctx.font=(d===0?'bold 13px':'10px')+' Courier New';
            tctx.textAlign='center';
            const t=n.title||D.address(n);
            tctx.fillText(t.length>22?t.slice(0,21)+'…':t, x, y+nr+13);
        }
        if(d>=MAXD){
            const f=D.filledSlots(n);
            if(f.length){ tctx.fillStyle='#57606f'; tctx.font='9px Courier New';
                tctx.fillText('+'+f.length, x, y+nr+22); }
            return;
        }
        const f=D.filledSlots(n);
        if(!f.length) return;
        const total=f.reduce((s,i)=>s+leaves(n.slots[i],d+1),0);
        let cur=d===0?0:a0;
        const span=d===0?Math.PI*2:(a1-a0);
        f.forEach(i=>{
            const w=leaves(n.slots[i],d+1)/total*span;
            place(n.slots[i],cur,cur+w,d+1,x,y);
            cur+=w;
        });
    })(twodRoot,0,Math.PI*2,0,cx,cy);
    tctx.fillStyle='#3d4452'; tctx.font='10px Courier New'; tctx.textAlign='left';
    tctx.fillText('3D Kuantum Not Evreni · radial indirgeme · '+new Date().toLocaleDateString('tr-TR'),16,innerHeight-16);
}

/* ============================================================ TOAST + TIP */
let toastTimer=null;
export function toast(m){
    const t=$('toast'); t.textContent=m; t.style.opacity=1;
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.style.opacity=0,2600);
}
function tipShow(t){ tip.style.display=t?'block':'none'; tip.textContent=t||''; }
function tipMove(e){ tip.style.left=(e.clientX+14)+'px'; tip.style.top=(e.clientY+14)+'px'; }
