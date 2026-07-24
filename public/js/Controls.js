/* =============================================================================
   Controls — ÇİFT KAMERA MODU
   🚀 Uçuş: WASD + fare bakışı, hız fraktal ölçeğe uyarlı, yakınlık doğumu
   🎯 Odak: tıklanan atoma MathUtils.lerp ile yumuşak yaklaşma + yörünge
   ============================================================================= */
import * as THREE from './three.js';
import { REDUCED, SHRINK, SPHERE_K } from './config.js';
import { State, SLOT_DIRS, worldOf, filledSlots } from './DataManager.js';
import * as Engine from './Engine3D.js';

export let dragging=false;
export let onHover=()=>{}, onClick=()=>{};
export function setHandlers(h,c){ onHover=h; onClick=c; }

const keys={};
let lon=-90, lat=0;                                   // uçuş bakışı
const orbit={lon:-90, lat:20, radius:180, targetR:180, center:new THREE.Vector3()}; // odak yörüngesi
let flyTarget=null;
let downPos=null, prev={x:0,y:0};
const _fwd=new THREE.Vector3(), _rgt=new THREE.Vector3(), _up=new THREE.Vector3(0,1,0);

function typing(){
    const a=document.activeElement;
    return a && (a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.tagName==='SELECT'||a.isContentEditable);
}
export let overlayOpen=()=>false;
export function setOverlayCheck(fn){ overlayOpen=fn; }

export function init(cvs){
    window.addEventListener('keydown', e=>{
        if(!typing() && !overlayOpen()) keys[e.code]=true;
    });
    window.addEventListener('keyup', e=>keys[e.code]=false);
    window.addEventListener('blur', ()=>{ for(const k in keys) keys[k]=false; });

    cvs.addEventListener('mousedown', e=>{
        dragging=true; downPos={x:e.clientX,y:e.clientY}; prev={x:e.clientX,y:e.clientY};
        cvs.classList.add('dragging');
    });
    window.addEventListener('mousemove', e=>{
        if(dragging){
            const dx=(e.clientX-prev.x), dy=(e.clientY-prev.y);
            if(State.mode==='flight'){
                lon+=dx*0.16; lat-=dy*0.16; lat=Math.max(-85,Math.min(85,lat));
                flyTarget=null;
            }else{ // odak: hedef etrafında dön
                orbit.lon+=dx*0.3; orbit.lat=Math.max(-80,Math.min(80, orbit.lat+dy*0.25));
            }
            prev={x:e.clientX,y:e.clientY};
        } else onHover(e);
    });
    window.addEventListener('mouseup', e=>{
        cvs.classList.remove('dragging');
        if(dragging && downPos && Math.hypot(e.clientX-downPos.x, e.clientY-downPos.y)<5) onClick(e);
        dragging=false;
    });
    cvs.addEventListener('wheel', e=>{
        if(State.mode!=='focus') return;
        e.preventDefault();
        const R=worldOf(State.openNode||{parent:null}).radius;
        orbit.targetR=THREE.MathUtils.clamp(orbit.targetR + e.deltaY*R*0.002, R*SPHERE_K*2.5, R*3.2);
    },{passive:false});

    let tstart=null, pinchD=null;
    const pdist=e=>Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
    cvs.addEventListener('touchstart', e=>{
        if(e.touches.length===2){ pinchD=pdist(e); tstart=null; return; }
        const t=e.touches[0]; tstart={x:t.clientX,y:t.clientY}; prev={x:t.clientX,y:t.clientY}; },{passive:true});
    cvs.addEventListener('touchmove', e=>{
        if(e.touches.length===2){ /* iki parmak kıstır: odak modunda yakınlaş/uzaklaş */
            e.preventDefault();
            const d=pdist(e);
            if(pinchD!=null && State.mode==='focus'){
                const R=worldOf(State.openNode||{parent:null}).radius;
                orbit.targetR=THREE.MathUtils.clamp(orbit.targetR+(pinchD-d)*R*0.006, R*SPHERE_K*2.5, R*3.2);
            }
            pinchD=d; return;
        }
        if(pinchD!=null) return; // kıstırmadan tek parmağa düşüş: bakışı sıçratma
        const t=e.touches[0];
        const dx=(t.clientX-prev.x), dy=(t.clientY-prev.y);
        if(State.mode==='flight'){ lon+=dx*0.16; lat-=dy*0.16; lat=Math.max(-85,Math.min(85,lat)); }
        else{ orbit.lon+=dx*0.3; orbit.lat=Math.max(-80,Math.min(80,orbit.lat+dy*0.25)); }
        prev={x:t.clientX,y:t.clientY}; },{passive:false});
    cvs.addEventListener('touchend', e=>{
        if(!e.touches.length) pinchD=null; // tüm parmaklar kalkınca kıstırma biter
        const t=e.changedTouches[0];
        if(tstart && Math.hypot(t.clientX-tstart.x,t.clientY-tstart.y)<8) onClick(t); tstart=null; });
}

/* ---------- mod geçişi ---------- */
export function setMode(m){
    State.mode=m;
    if(m==='focus' && State.openNode) focusOn(State.openNode, false);
    if(m==='flight'){
        /* bakış açısını mevcut kamera yönünden devral: sıçrama olmaz */
        const f=new THREE.Vector3(); Engine.camera.getWorldDirection(f);
        lat=THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(f.y,-1,1)));
        lon=THREE.MathUtils.radToDeg(Math.atan2(f.z,f.x));
    }
}

/* ---------- uçuş yardımcıları ---------- */
function forward(){
    const phi=THREE.MathUtils.degToRad(90-lat), th=THREE.MathUtils.degToRad(lon);
    return _fwd.set(Math.sin(phi)*Math.cos(th), Math.cos(phi), Math.sin(phi)*Math.sin(th));
}
export function lookToward(target){
    const d=target.clone().sub(Engine.camera.position).normalize();
    lat=THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y,-1,1)));
    lon=THREE.MathUtils.radToDeg(Math.atan2(d.z,d.x));
}
export function spawnNear(node){
    const W=worldOf(node), sr=W.radius*SPHERE_K;
    Engine.camera.position.copy(W.pos).add(new THREE.Vector3(sr*2.2, sr*1.6, sr*4.5));
    lookToward(W.pos);
    flyTarget=null;
    if(State.mode==='focus') focusOn(node, true);
}
export function flyTo(node){
    if(State.mode==='focus'){ focusOn(node, false); return; }
    const W=worldOf(node), sr=W.radius*SPHERE_K;
    flyTarget=W.pos.clone().add(new THREE.Vector3(sr*2, sr*1.4, sr*3.8));
    if(REDUCED){ Engine.camera.position.copy(flyTarget); flyTarget=null; lookToward(W.pos); }
}

/* ---------- odak modu: mevcut konumdan küresel koordinat türet → sıçramasız,
   sonra yarıçap ideale doğru lerp'lenir (yumuşak yaklaşma) ---------- */
export function focusOn(node, snap){
    const W=worldOf(node);
    orbit.center.copy(W.pos);
    const rel=Engine.camera.position.clone().sub(W.pos);
    const r=Math.max(rel.length(), W.radius*SPHERE_K*2.5);
    orbit.radius=snap?W.radius*1.25:r;
    orbit.targetR=W.radius*1.25;
    orbit.lat=THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(rel.y/Math.max(r,1e-6),-1,1)))||20;
    orbit.lon=THREE.MathUtils.radToDeg(Math.atan2(rel.z,rel.x))||-90;
    if(REDUCED) orbit.radius=orbit.targetR;
}

/* ---------- her kare ---------- */
export function update(dt){
    const cam=Engine.camera;
    if(!State.openNode) return 0;
    const W=worldOf(State.openNode);
    const R=W.radius;
    let speed=0;

    if(State.mode==='flight'){
        const f=forward();
        cam.lookAt(cam.position.x+f.x, cam.position.y+f.y, cam.position.z+f.z);
        speed=R*0.85*((keys['ShiftLeft']||keys['ShiftRight'])?3:1);
        _rgt.crossVectors(f,_up).normalize();
        let moved=false;
        if(keys['KeyW']){ cam.position.addScaledVector(f, speed*dt); moved=true; }
        if(keys['KeyS']){ cam.position.addScaledVector(f,-speed*dt); moved=true; }
        if(keys['KeyA']){ cam.position.addScaledVector(_rgt,-speed*dt); moved=true; }
        if(keys['KeyD']){ cam.position.addScaledVector(_rgt, speed*dt); moved=true; }
        if(keys['Space']){ cam.position.y+=speed*dt*0.8; moved=true; }
        if(keys['KeyC']){ cam.position.y-=speed*dt*0.8; moved=true; }
        if(moved) flyTarget=null;

        if(flyTarget){
            cam.position.lerp(flyTarget, 1-Math.pow(0.02,dt));
            if(cam.position.distanceTo(flyTarget)<R*0.01) flyTarget=null;
        }

        /* yakınlık tabanlı katman doğumu (sadece uçuşta) */
        proxTimer+=dt;
        if(proxTimer>0.18){
            proxTimer=0;
            let switched=false;
            for(const i of filledSlots(State.openNode)){
                const cp=W.pos.clone().addScaledVector(SLOT_DIRS[i], W.radius);
                if(cam.position.distanceTo(cp) < W.radius*SHRINK*1.35){
                    Engine.buildView(State.openNode.slots[i]); switched=true; break;
                }
            }
            if(!switched && State.openNode.parent &&
               cam.position.distanceTo(W.pos) > W.radius*2.1){
                Engine.buildView(State.openNode.parent);
            }
        }
    } else {
        /* odak/yörünge: konum küresel koordinattan, yarıçap yumuşak lerp */
        if(keys['KeyW']) orbit.targetR=Math.max(R*SPHERE_K*2.5, orbit.targetR-R*0.9*dt);
        if(keys['KeyS']) orbit.targetR=Math.min(R*3.2, orbit.targetR+R*0.9*dt);
        if(keys['KeyA']) orbit.lon-=60*dt;
        if(keys['KeyD']) orbit.lon+=60*dt;
        orbit.radius=THREE.MathUtils.lerp(orbit.radius, orbit.targetR, 1-Math.pow(0.005,dt));
        orbit.center.lerp(worldOf(State.openNode).pos, 1-Math.pow(0.002,dt));
        const phi=THREE.MathUtils.degToRad(90-orbit.lat), th=THREE.MathUtils.degToRad(orbit.lon);
        cam.position.set(
            orbit.center.x+orbit.radius*Math.sin(phi)*Math.cos(th),
            orbit.center.y+orbit.radius*Math.cos(phi),
            orbit.center.z+orbit.radius*Math.sin(phi)*Math.sin(th));
        cam.lookAt(orbit.center);
        speed=0;
    }
    return speed;
}
let proxTimer=0;
