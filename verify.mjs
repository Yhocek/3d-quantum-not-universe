import fs from 'fs';
const files=['config','DataManager','Engine3D','Controls','UIManager','main','three'];
const exports={};
for(const f of files){
    const src=fs.readFileSync('public/js/'+f+'.js','utf8');
    exports[f]=new Set();
    for(const m of src.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+(\w+)/g)) exports[f].add(m[1]);
    for(const m of src.matchAll(/export\s+(?:const|let|var)\s+([^;\n]+)/g)){
        // "a=1, b=[]" ve "a, b" biçimlerini ayrıştır: üst seviye virgüllerde böl
        let depth=0, cur='', names=[];
        for(const ch of m[1]){
            if('([{'.includes(ch)) depth++;
            if(')]}'.includes(ch)) depth--;
            if(ch===',' && depth===0){ names.push(cur); cur=''; } else cur+=ch;
        }
        names.push(cur);
        names.forEach(x=>exports[f].add(x.trim().split(/[=\s]/)[0]));
    }
    for(const m of src.matchAll(/export\s*\{([^}]+)\}/g))
        m[1].split(',').forEach(x=>exports[f].add(x.trim().split(/\s+as\s+/).pop()));
}
let bad=0;
const nsMap={D:'DataManager', Engine:'Engine3D', Controls:'Controls', UI:'UIManager', THREE:null};
for(const f of files){
    const raw=fs.readFileSync('public/js/'+f+'.js','utf8');
    const src=raw.replace(/^import[^\n]+\n/gm,'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
    for(const [ns,from] of Object.entries(nsMap)){
        if(!from) continue;
        if(!raw.includes('as '+ns+" from './"+from)) continue;
        const used=new Set([...src.matchAll(new RegExp('\\b'+ns+'\\.(\\w+)','g'))].map(x=>x[1]));
        for(const u of used) if(!exports[from].has(u)){ console.log('EKSİK EXPORT:', f+'.js kullanıyor →', ns+'.'+u, '(kaynak:', from+'.js)'); bad++; }
    }
    for(const m of raw.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/(\w+)\.js'/g))
        m[1].split(',').forEach(x=>{
            const name=x.trim().split(/\s+as\s+/)[0];
            if(!exports[m[2]].has(name)){ console.log('EKSİK IMPORT:', f+'.js ←', m[2]+'.'+name); bad++; }
        });
}
/* HTML ID kapsamı */
const html=fs.readFileSync('public/index.html','utf8');
const ids=new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]));
for(const f of files){
    const src=fs.readFileSync('public/js/'+f+'.js','utf8');
    for(const m of src.matchAll(/getElementById\('([\w-]+)'\)/g))
        if(!ids.has(m[1])){ console.log('HTML ID YOK:', f+'.js →', '#'+m[1]); bad++; }
    for(const m of src.matchAll(/\$\('([\w-]+)'\)/g))
        if(!ids.has(m[1])){ console.log('HTML ID YOK ($):', f+'.js →', '#'+m[1]); bad++; }
}
/* HTML'deki onclick vb. inline referanslar */
for(const m of html.matchAll(/getElementById\('([\w-]+)'\)/g))
    if(!ids.has(m[1])){ console.log('HTML ID YOK (inline):', '#'+m[1]); bad++; }
/* CSS'te kullanılan id'ler HTML'de var mı (ölü #atom-cta kabul) */
const css=fs.readFileSync('public/css/style.css','utf8');
for(const m of css.matchAll(/#([\w-]+)\s*[{.,:]/g))
    if(!ids.has(m[1]) && m[1]!=='atom-cta') console.log('BİLGİ: CSS id HTML\'de yok →', '#'+m[1]);
console.log(bad? '✗ '+bad+' sorun':'✓ ÇAPRAZ KONTROL TEMİZ');
