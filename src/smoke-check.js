const fs=require('fs');
const path=require('path');
const files=['index.js','db.js','music.js','status.js'];
for(const f of files){
  const p=path.join(__dirname,f);
  if(!fs.existsSync(p))throw new Error(`Missing ${f}`);
}
const index=fs.readFileSync(path.join(__dirname,'index.js'),'utf8');
if(index.includes('guildIdOf('))throw new Error('Old guildIdOf regression is still present');
console.log('SH Protection Shield V6.3 source smoke check: PASS');
