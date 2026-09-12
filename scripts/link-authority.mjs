import {readFileSync,writeFileSync} from 'node:fs';
for(const n of ['index.html','platform.html','blockchain.html','pricing.html','about.html','services.html']){
 const p='public/'+n;let s=readFileSync(p,'utf8');
 if(!s.includes('href="/authority.html"'))s=s.replace('<nav aria-label="Main navigation">','<nav aria-label="Main navigation"><a href="/authority.html">Authority Standard</a>');
 writeFileSync(p,s);
}

