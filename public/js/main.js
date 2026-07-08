/* =============================================================================
   main — başlangıç sırası + ana döngü
   probe → URL → defterler/paylaşım → Engine/Controls/UI → odak → animate
   ============================================================================= */
import * as THREE from './three.js';
import * as D from './DataManager.js';
import { State } from './DataManager.js';
import * as Engine from './Engine3D.js';
import * as Controls from './Controls.js';
import * as UI from './UIManager.js';

const clock=new THREE.Clock();
function animate(){
    requestAnimationFrame(animate);
    const dt=Math.min(clock.getDelta(),0.05);
    const t=clock.elapsedTime;
    const speed=Controls.update(dt);
    Engine.render(t);
    UI.updateOverlays();
    document.getElementById('st-speed').innerText=speed.toFixed(1);
    document.getElementById('st-calls').innerText=Engine.drawCalls();
}

(async function init(){
    await D.probe();

    const q=new URLSearchParams(location.search);
    State.renderDepth=Math.min(3,Math.max(1,parseInt(q.get('depth'))||2));
    document.getElementById('depth-sel').value=State.renderDepth;

    Engine.init();
    Controls.init(Engine.canvas);
    UI.init();
    UI.applyModeUI();

    /* paylaşım linki (?s=): alt ağaç yeni defter olarak açılır */
    if(q.get('s') && State.serverOn){
        try{
            const sh=await D.api('share/'+q.get('s'));
            State.notebooks.push({id:null, name:'Paylaşılan: '+sh.name, root:D.fromStd(sh.root)});
        }catch(e){ UI.toast('Paylaşım bulunamadı.'); }
    }

    /* sunucu açık ama oturum yok: kimlik katmanı (altta yerel mod çalışır) */
    if(State.serverOn && !State.user){
        UI.showAuth();
        State.serverOn=false; // giriş yapılana dek sunucuya yazılmaz; giriş → reload
    }

    await D.loadNotebookList();

    /* çevrimdışı: daha önce IndexedDB'ye aynalanan ağaçları geri yükle */
    if(!State.serverOn){
        const locals=await D.loadLocalTrees();
        locals.sort((a,b)=>(b.ts||0)-(a.ts||0)).forEach(t=>{
            State.notebooks.push({id:t.id||null, localKey:t.key, name:t.name||'Yerel Defter', root:D.fromStd(t.root)});
        });
    }

    if(!State.notebooks.length){
        State.notebooks.push({id:null, name:'Defter 1 (yerel)', root:D.seedRoot()});
    }

    let idx=0;
    if(q.get('s')) idx=0;
    else if(q.get('nb')){ const j=State.notebooks.findIndex(n=>n.id===q.get('nb')); if(j>=0) idx=j; }
    UI.refreshNbSelect(idx);
    await UI.switchNotebook(idx);

    const focusAddr=q.get('focus');
    if(focusAddr && focusAddr!=='0'){
        const target=D.nodeByAddress(D.currentRoot(), focusAddr);
        State.selNode=target;
        Engine.buildView(target);
        Controls.spawnNear(target);
    }
    animate();
})();
