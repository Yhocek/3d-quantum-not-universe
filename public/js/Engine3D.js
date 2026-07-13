/* =============================================================================
   Engine3D — sahne, kamera, render döngüsü, instancing, bloom, kuantum shader,
   etiketler, ekler, solucan delikleri, raycast, üstten PNG dışa aktarım
   ============================================================================= */
import * as THREE from './three.js';
import { JSM_BASE } from './three.js';
import { SLOT_COUNT, SHRINK, SPHERE_K, PALETTE, hashStr, truncTitle } from './config.js';
import { State, SLOT_DIRS, worldOf, address, filledSlots, nodeById, currentNb, inTreeOf, resolveLink } from './DataManager.js';

export let renderer, camera, scene, canvas;
export const atomInst=[], slotInst=[];
export let onViewChanged=()=>{}; // UIManager bağlar
export function setViewChanged(fn){ onViewChanged=fn; }

let atomsMesh, slotsMesh, bondLines=null, grandPoints=null, linkLines=null;
let selLine=null, selPathIdx=new Map(), lastSel=null, lastOpen=null;
let attachGroup, labelPool=[];
let composer=null, bloomPass=null, atomShader=null;
const LABEL_CAP=60;
const _m=new THREE.Matrix4(), _q=new THREE.Quaternion(), _s=new THREE.Vector3(), _proj=new THREE.Vector3();
const _white=new THREE.Color(0xffffff), _green=new THREE.Color(0x2ed573),
      _dimCol=new THREE.Color(0x3a4152), _tmpCol=new THREE.Color();

export function colorOf(n){ return new THREE.Color(PALETTE[hashStr(n.id)%PALETTE.length]); }

/* ---------------------------------------------------------------- kurulum */
export function init(){
    scene=new THREE.Scene();
    scene.fog=new THREE.FogExp2(0x020208, 0.0028);
    camera=new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.01, 4000);
    renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.domElement.id='gl';
    document.body.appendChild(renderer.domElement);
    canvas=renderer.domElement;

    /* yıldızlar */
    const N=900, pos=new Float32Array(N*3);
    let sd=42; const rng=()=>{ sd=sd*16807%2147483647; return sd/2147483647; };
    for(let i=0;i<N;i++){ const r=600+rng()*1100, th=rng()*Math.PI*2, ph=Math.acos(2*rng()-1);
        pos.set([r*Math.sin(ph)*Math.cos(th), r*Math.cos(ph), r*Math.sin(ph)*Math.sin(th)], i*3); }
    const sg=new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos,3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({color:0x2a3040, size:1.6})));

    /* --- Geometry Batching: 2 InstancedMesh --- */
    const atomGeo=new THREE.SphereGeometry(1,24,24);
    const atomMat=new THREE.MeshBasicMaterial({color:0xffffff});
    injectQuantumShader(atomMat); // kuantum dalgalanma + fresnel parlama
    atomsMesh=new THREE.InstancedMesh(atomGeo, atomMat, 72);
    slotsMesh=new THREE.InstancedMesh(atomGeo, new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.8}), SLOT_COUNT);
    atomsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    slotsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(atomsMesh, slotsMesh);

    attachGroup=new THREE.Group(); scene.add(attachGroup);

    for(let i=0;i<LABEL_CAP;i++){
        const c=document.createElement('canvas'); c.width=512; c.height=160;
        const tex=new THREE.CanvasTexture(c);
        const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthWrite:false}));
        spr.visible=false; scene.add(spr);
        labelPool.push({spr,c,tex});
    }

    initPost(); // bloom (başarısız olursa sessizce düz render'a düşer)

    /* --- EKRAN SENKRONİZASYONU ---
       resize + orientationchange + visualViewport (mobil adres çubuğu) +
       DPR değişimi (pencere kavisli/harici monitöre taşınınca) tek yerden */
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if(window.visualViewport) visualViewport.addEventListener('resize', onResize);
    (function watchDPR(){
        matchMedia('(resolution: '+devicePixelRatio+'dppx)')
            .addEventListener('change', ()=>{ onResize(); watchDPR(); }, {once:true});
    })();
    onResize(); // ilk FOV/DPR senkronu
}
/* Dikey FOV'u ekran şekliyle senkronla: ultrageniş/kavisli ekranda yatay görüş
   105°'yi aşmasın (kenar bozulması), dikey telefonda 60°'nin altına inmesin
   (görüş daralması). 16:9 ve karesel ekranlar 70° tabanında kalır. */
function fovForAspect(aspect){
    const BASE=70, H_MAX=105, H_MIN=60, half=x=>THREE.MathUtils.degToRad(x/2);
    const hDeg=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(half(BASE))*aspect));
    if(hDeg>H_MAX) return THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(half(H_MAX))/aspect));
    if(hDeg<H_MIN) return THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(half(H_MIN))/aspect));
    return BASE;
}
function onResize(){
    camera.aspect=innerWidth/innerHeight;
    camera.fov=fovForAspect(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio,2)); // monitör geçişi: DPR tazele
    renderer.setSize(innerWidth, innerHeight);
    if(composer) composer.setSize(innerWidth, innerHeight);
}

/* --- KUANTUM SHADER: MeshBasicMaterial'a onBeforeCompile ile dalga + fresnel
   enjekte edilir; InstancedMesh + instanceColor boru hattı bozulmaz. --- */
function injectQuantumShader(mat){
    mat.onBeforeCompile = sh=>{
        sh.uniforms.uTime={value:0};
        atomShader=sh;
        sh.vertexShader = 'uniform float uTime;\nvarying vec3 vVP;\n' + sh.vertexShader
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vec3 sn = normalize(position); /* birim küre: pozisyon = normal */
                float wob = sin(position.x*7.0 + uTime*1.7)
                          * sin(position.y*6.0 + uTime*1.3)
                          * sin(position.z*8.0 + uTime*1.1);
                transformed += sn * wob * 0.05;`)
            .replace('#include <project_vertex>', `#include <project_vertex>
                vVP = mvPosition.xyz;`);
        sh.fragmentShader = 'varying vec3 vVP;\n' + sh.fragmentShader
            .replace('#include <dithering_fragment>', `#include <dithering_fragment>
                vec3 nrm = normalize(cross(dFdx(vVP), dFdy(vVP)));
                float fres = pow(1.0 - abs(dot(nrm, normalize(-vVP))), 2.0);
                gl_FragColor.rgb += gl_FragColor.rgb * fres * 1.1;`);
    };
}

/* --- Post-processing: UnrealBloomPass (dinamik import; yoksa düz render) --- */
async function initPost(){
    try{
        const [{EffectComposer},{RenderPass},{UnrealBloomPass}] = await Promise.all([
            import(JSM_BASE+'postprocessing/EffectComposer.js'),
            import(JSM_BASE+'postprocessing/RenderPass.js'),
            import(JSM_BASE+'postprocessing/UnrealBloomPass.js')
        ]);
        composer=new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene,camera));
        bloomPass=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight), 0.85, 0.55, 0.15);
        composer.addPass(bloomPass);
        composer.setSize(innerWidth, innerHeight);
    }catch(e){ console.warn('Bloom yüklenemedi, düz render:', e.message); composer=null; }
}

/* ------------------------------------------------------------- görünüm kur */
export function buildView(node){
    State.openNode=node;
    const W=worldOf(node), R=W.radius, C=W.pos;
    atomInst.length=0; slotInst.length=0;
    [bondLines, grandPoints, linkLines, selLine].forEach(o=>{ if(o){ scene.remove(o); o.geometry.dispose(); } });
    bondLines=grandPoints=linkLines=selLine=null;
    lastSel=lastOpen=null; selPathIdx.clear(); // seçim yolu yeni görünümde tazelenir

    atomInst.push({node, pos:C.clone(), r:R*SPHERE_K, color:new THREE.Color(0xff4757), kind:'open'});

    const linePos=[], lineCol=[], gPos=[], gCol=[], wormPos=[];
    if(node.parent){
        const PW=worldOf(node.parent);
        atomInst.push({node:node.parent, pos:PW.pos.clone(), r:PW.radius*SPHERE_K,
                       color:new THREE.Color(0x57606f), kind:'parent'});
        linePos.push(C.x,C.y,C.z, PW.pos.x,PW.pos.y,PW.pos.z);
        lineCol.push(1,0.28,0.34, 0.1,0.12,0.16);
    }

    for(let i=0;i<SLOT_COUNT;i++){
        const end=C.clone().addScaledVector(SLOT_DIRS[i], R);
        const child=node.slots[i];
        if(child){
            const col=colorOf(child);
            atomInst.push({node:child, pos:end, r:R*SHRINK*SPHERE_K, color:col, kind:'child'});
            linePos.push(C.x,C.y,C.z, end.x,end.y,end.z);
            lineCol.push(1,0.28,0.34, col.r*0.55,col.g*0.55,col.b*0.55);
            if(State.renderDepth>=2){
                const cr=R*SHRINK;
                filledSlots(child).forEach(j=>{
                    const g2=child.slots[j];
                    const gp=end.clone().addScaledVector(SLOT_DIRS[j], cr);
                    gPos.push(gp.x,gp.y,gp.z); gCol.push(col.r*0.8,col.g*0.8,col.b*0.8);
                    linePos.push(end.x,end.y,end.z, gp.x,gp.y,gp.z);
                    lineCol.push(col.r*0.22,col.g*0.22,col.b*0.22, 0.05,0.06,0.09);
                    if(State.renderDepth>=3){
                        filledSlots(g2).forEach(k=>{
                            const gp2=gp.clone().addScaledVector(SLOT_DIRS[k], cr*SHRINK);
                            gPos.push(gp2.x,gp2.y,gp2.z); gCol.push(col.r*0.35,col.g*0.35,col.b*0.35);
                        });
                    }
                });
            }
        }else{
            slotInst.push({slotIndex:i, pos:end, r:R*SHRINK*SPHERE_K*0.32});
            linePos.push(C.x,C.y,C.z, end.x,end.y,end.z);
            lineCol.push(0.5,0.16,0.2, 0.09,0.1,0.14);
        }
    }

    /* --- KUANTUM TÜNELLEME: solucan deliği bağları + portal atomları ---
       Açık atom ve çocuklarının uzak bağlantılarına kesikli çizgi uzanır;
       kaynağın yanındaki mor portale tıklayınca diğer uca ışınlanılır.   */
    const linkSources=[{n:node, p:C, r:R*SPHERE_K}];
    filledSlots(node).forEach(i=>linkSources.push({
        n:node.slots[i], p:C.clone().addScaledVector(SLOT_DIRS[i],R), r:R*SHRINK*SPHERE_K }));
    linkSources.forEach(src=>{
        (src.n.links||[]).forEach(id=>{
            const RL=resolveLink(id);
            if(!RL || RL.node===src.n) return;
            const target=RL.node;
            if(RL.nbIndex!==State.nbIndex){
                /* defterler arası (Obsidian tarzı): hedef başka evrende —
                   çizgi çizilmez, macenta portal defter geçişini temsil eder */
                const ang=(hashStr(id)%628)/100;
                const dir=new THREE.Vector3(Math.cos(ang),0.35,Math.sin(ang)).normalize();
                atomInst.push({node:target, via:src.n, xnb:RL.nbIndex,
                               pos:src.p.clone().addScaledVector(dir, src.r*3.2),
                               r:src.r*0.55, color:new THREE.Color(0xff5fd0), kind:'portal'});
                return;
            }
            const TW=worldOf(target);
            wormPos.push(src.p.x,src.p.y,src.p.z, TW.pos.x,TW.pos.y,TW.pos.z);
            const dir=TW.pos.clone().sub(src.p).normalize();
            atomInst.push({node:target, via:src.n, pos:src.p.clone().addScaledVector(dir, src.r*3.2),
                           r:src.r*0.55, color:new THREE.Color(0x7d5fff), kind:'portal'});
        });
    });

    const lg=new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos,3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lineCol,3));
    bondLines=new THREE.LineSegments(lg, new THREE.LineBasicMaterial({vertexColors:true, transparent:true, opacity:0.85}));
    scene.add(bondLines);

    if(gPos.length){
        const pg=new THREE.BufferGeometry();
        pg.setAttribute('position', new THREE.Float32BufferAttribute(gPos,3));
        pg.setAttribute('color', new THREE.Float32BufferAttribute(gCol,3));
        grandPoints=new THREE.Points(pg, new THREE.PointsMaterial({vertexColors:true, size:2.2, sizeAttenuation:true, transparent:true, opacity:0.9}));
        scene.add(grandPoints);
    }
    if(wormPos.length){
        const wg=new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(wormPos,3));
        linkLines=new THREE.LineSegments(wg, new THREE.LineDashedMaterial({
            color:0x7d5fff, dashSize:R*0.06, gapSize:R*0.05, transparent:true, opacity:0.65}));
        linkLines.computeLineDistances();
        scene.add(linkLines);
    }

    /* kapasite koruması: 72'lik InstancedMesh sınırı aşılmasın (aşırı portal durumu) */
    const CAP=72;
    if(atomInst.length>CAP) atomInst.length=CAP;
    atomsMesh.count=atomInst.length;
    slotsMesh.count=slotInst.length;
    refreshLabels();
    buildAttachments();
    const root=currentNb() && currentNb().root;
    if(!State.selNode || !root || !inTreeOf(State.selNode, root)) State.selNode=node;
    onViewChanged();
}

/* ------------------------- SEÇİM YOLU: merkezden seçili noktaya renk -------
   Bir atom seçildiğinde merkezden (açık küme) seçili düğüme uzanan zincir
   renkli kalır ve renk dalgası merkezden dışa doğru akar; yol dışındaki
   atomlar soluklaşır. Zincir boyunca gradyan bir çizgi de çizilir.        */
function updateSelPath(){
    lastSel=State.selNode; lastOpen=State.openNode;
    selPathIdx.clear();
    if(selLine){ scene.remove(selLine); selLine.geometry.dispose(); selLine.material.dispose(); selLine=null; }
    const open=State.openNode, sel=State.selNode;
    if(!open || !sel || sel===open || !inTreeOf(sel,open)) return;
    const chain=[]; let n=sel;
    while(n && n!==open){ chain.unshift(n); n=n.parent; }
    chain.unshift(open);
    chain.forEach((c,i)=>selPathIdx.set(c.id,i));
    const pos=[], col=[], c0=new THREE.Color(0xff4757), c1=colorOf(sel);
    chain.forEach((c,i)=>{
        const W=worldOf(c);
        pos.push(W.pos.x,W.pos.y,W.pos.z);
        _tmpCol.copy(c0).lerp(c1, chain.length>1?i/(chain.length-1):1);
        col.push(_tmpCol.r,_tmpCol.g,_tmpCol.b);
    });
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col,3));
    selLine=new THREE.Line(g, new THREE.LineBasicMaterial({vertexColors:true, transparent:true, opacity:0.95}));
    scene.add(selLine);
}

/* ------------------------------------------------------- instance yazımı */
export let hoverAtom=-1, hoverSlot=-1;
export function setHover(a,s){ hoverAtom=a; hoverSlot=s; }
export function writeInstances(t){
    if(State.selNode!==lastSel || State.openNode!==lastOpen) updateSelPath();
    for(let i=0;i<atomInst.length;i++){
        const a=atomInst[i];
        let s=a.r;
        if(a.kind==='open') s*=1+Math.sin(t*1.4)*0.03;
        if(a.kind==='portal') s*=1+Math.sin(t*4+i)*0.18;
        if(i===hoverAtom) s*=1.15;
        if(a.node===State.selNode && a.kind==='child') s*=1.12;
        _s.set(s,s,s); _q.identity(); _m.compose(a.pos,_q,_s);
        atomsMesh.setMatrixAt(i,_m);
        /* renk önceliği: arama vurgusu > seçim yolu > normal */
        let col=a.color;
        if(State.searchHits.has(a.node.id) && a.kind!=='portal')
            col=_tmpCol.copy(a.color).lerp(_white, 0.55+0.4*Math.sin(t*5));
        else if(selPathIdx.size && a.kind!=='portal'){
            const idx=selPathIdx.get(a.node.id);
            if(idx!=null) /* yolda: merkezden dışa akan parlaklık dalgası */
                col=_tmpCol.copy(a.color).lerp(_white, 0.2+0.4*Math.max(0,Math.sin(t*3-idx*1.1)));
            else /* yol dışı: soluklaş — seçili zincir öne çıksın */
                col=_tmpCol.copy(a.color).lerp(_dimCol,0.6);
        }
        else if(a.node===State.selNode && a.kind==='child')
            col=_tmpCol.copy(a.color).lerp(_white,0.45);
        atomsMesh.setColorAt(i,col);
    }
    atomsMesh.instanceMatrix.needsUpdate=true;
    if(atomsMesh.instanceColor) atomsMesh.instanceColor.needsUpdate=true;

    for(let i=0;i<slotInst.length;i++){
        const d=slotInst[i];
        const onboarding = State.onboardSlot===d.slotIndex;
        const s=d.r*(i===hoverSlot?1.9:(onboarding?1.6+0.4*Math.sin(t*4):1));
        _s.set(s,s,s); _q.identity(); _m.compose(d.pos,_q,_s);
        slotsMesh.setMatrixAt(i,_m);
        slotsMesh.setColorAt(i, (i===hoverSlot||onboarding)?_green:_dimCol);
    }
    slotsMesh.instanceMatrix.needsUpdate=true;
    if(slotsMesh.instanceColor) slotsMesh.instanceColor.needsUpdate=true;
}

/* --------------------------------------------------------------- etiketler */
function drawLabel(i,node,pos,r,isOpen){
    const L=labelPool[i], x=L.c.getContext('2d');
    x.clearRect(0,0,512,160);
    x.textAlign='center'; x.shadowColor='#020208'; x.shadowBlur=9;
    const title=(node.title||'').trim(), addr=address(node);
    if(title){
        x.font='bold 42px Courier New'; x.fillStyle=isOpen?'#ff8a95':'#e8edf2';
        x.fillText(truncTitle(title,20),256,62);
        x.font='28px Courier New'; x.fillStyle='#ffa502';
        x.fillText(addr,256,114);
    }else{
        x.font='32px Courier New'; x.fillStyle='#ffa502';
        x.fillText(addr,256,92);
    }
    L.tex.needsUpdate=true;
    const w=r*9;
    L.spr.scale.set(w, w*160/512, 1);
    L.spr.position.set(pos.x, pos.y+r*2.1+w*0.13, pos.z);
    L.spr.visible=true;
}
export function refreshLabels(){
    labelPool.forEach(L=>L.spr.visible=false);
    atomInst.forEach((a,i)=>{ if(i<LABEL_CAP && a.kind!=='portal') drawLabel(i,a.node,a.pos,a.r,a.kind==='open'); });
}
export function refreshLabelFor(node){
    const i=atomInst.findIndex(a=>a.node===node && a.kind!=='portal');
    if(i>=0 && i<LABEL_CAP) drawLabel(i,node,atomInst[i].pos,atomInst[i].r,atomInst[i].kind==='open');
}

/* ------------------------------------------------------------------ ekler */
import { resolveAsset } from './DataManager.js';
const texCache=new Map();
const docIconCache=new Map();
function docIconTex(name){
    if(docIconCache.has(name)) return docIconCache.get(name);
    const c=document.createElement('canvas'); c.width=256; c.height=256;
    const x=c.getContext('2d');
    x.strokeStyle='#ffa502'; x.lineWidth=6; x.setLineDash([12,8]);
    x.strokeRect(48,20,160,190);
    x.font='90px serif'; x.textAlign='center'; x.fillText('📄',128,140);
    x.setLineDash([]); x.fillStyle='#ffa502'; x.font='bold 24px Courier New';
    x.fillText(name.length>16?name.slice(0,15)+'…':name,128,242);
    const t=new THREE.CanvasTexture(c); docIconCache.set(name,t); return t;
}
export function buildAttachments(){
    while(attachGroup.children.length){
        const ch=attachGroup.children[0];
        attachGroup.remove(ch); ch.material.dispose();
    }
    const node=State.openNode; if(!node) return;
    const W=worldOf(node), sr=W.radius*SPHERE_K;
    const items=[...node.images.map(a=>({t:'img',a})), ...node.docs.map(a=>({t:'doc',a}))];
    items.forEach((it,i)=>{
        const ang=(i/Math.max(items.length,1))*Math.PI*2+0.5;
        const pos=W.pos.clone().add(new THREE.Vector3(Math.cos(ang)*sr*3.2, sr*1.6+(i%2)*sr*0.9, Math.sin(ang)*sr*3.2));
        let spr;
        if(it.t==='img'){
            spr=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true, depthWrite:false, opacity:0}));
            const h=sr*2.4, w=h*(it.a.aspect||1);
            spr.scale.set(w,h,1);
            hydrateImage(spr, it.a); // dataURL asenkron çözülür
        }else{
            spr=new THREE.Sprite(new THREE.SpriteMaterial({map:docIconTex(it.a.name), transparent:true, depthWrite:false}));
            spr.scale.set(sr*1.7, sr*1.7, 1);
        }
        spr.position.copy(pos);
        spr.userData={att:it.a, type:it.t};
        attachGroup.add(spr);
    });
}
async function hydrateImage(spr, att){
    if(texCache.has(att.assetId)){ spr.material.map=texCache.get(att.assetId); spr.material.needsUpdate=true; return; }
    const rec=await resolveAsset(att.assetId);
    if(!rec || !spr.parent) return;
    const tex=new THREE.TextureLoader().load(rec.dataURL);
    texCache.set(att.assetId, tex);
    spr.material.map=tex; spr.material.needsUpdate=true;
}
export function fadeAttachments(){
    const node=State.openNode; if(!node) return;
    const R=worldOf(node).radius;
    attachGroup.children.forEach(spr=>{
        const d=camera.position.distanceTo(spr.position);
        const o=THREE.MathUtils.clamp((R*3.2-d)/(R*1.6),0,1);
        spr.material.opacity=spr.material.map?o:0;
        spr.visible=o>0.02;
    });
}

/* ------------------------------------------------------ raycast + izdüşüm */
const ray=new THREE.Raycaster(), mouse=new THREE.Vector2();
export function pick(e){
    mouse.x=(e.clientX/innerWidth)*2-1; mouse.y=-(e.clientY/innerHeight)*2+1;
    ray.setFromCamera(mouse,camera);
    return ray.intersectObjects([atomsMesh, slotsMesh, ...attachGroup.children])[0]||null;
}
export function toScreen(pos){
    _proj.copy(pos).project(camera);
    if(_proj.z>1||_proj.z<-1) return null;
    return {x:(_proj.x*0.5+0.5)*innerWidth, y:(-_proj.y*0.5+0.5)*innerHeight};
}

/* -------------------------------------------------------------- kare çizimi */
export function render(t){
    if(!State.openNode) return;
    writeInstances(t);
    fadeAttachments();
    const RL=worldOf(State.openNode).radius;
    for(const L of labelPool){
        if(!L.spr.visible) continue;
        const d=camera.position.distanceTo(L.spr.position);
        L.spr.material.opacity=THREE.MathUtils.clamp((RL*3.4-d)/(RL*1.2),0,1);
    }
    if(atomShader) atomShader.uniforms.uTime.value=t;
    if(composer) composer.render();
    else renderer.render(scene,camera);
}
export function drawCalls(){ return renderer.info.render.calls; }
export function getMeshes(){ return { atomsMesh, slotsMesh }; }

/* -------------------------------------------- ortografik üstten PNG çıktısı */
export function exportTopDown(){
    const node=State.openNode; if(!node) return null;
    const W=worldOf(node), s=W.radius*1.5;
    const cam=new THREE.OrthographicCamera(-s,s,s,-s,0.01,4000);
    cam.position.set(W.pos.x, W.pos.y+W.radius*3, W.pos.z);
    cam.up.set(0,0,-1);
    cam.lookAt(W.pos);
    renderer.render(scene,cam); // bloom'suz temiz tek kare
    return renderer.domElement.toDataURL('image/png');
}
