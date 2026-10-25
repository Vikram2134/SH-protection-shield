const DB=require('better-sqlite3');
const db=new DB('shield-v6.db'); db.pragma('journal_mode=WAL'); db.pragma('foreign_keys=ON');
db.exec(`
CREATE TABLE IF NOT EXISTS guild_config(guild TEXT PRIMARY KEY,json TEXT NOT NULL DEFAULT '{}',updated INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS trust(guild TEXT,user TEXT,PRIMARY KEY(guild,user));
CREATE TABLE IF NOT EXISTS incidents(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,executor TEXT,type TEXT,ms INTEGER,at INTEGER);
CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,channel TEXT UNIQUE,opener TEXT,claimed TEXT,status TEXT DEFAULT 'open',ai TEXT DEFAULT 'assist',at INTEGER);
CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,data TEXT,at INTEGER);
CREATE TABLE IF NOT EXISTS warnings(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,user TEXT,moderator TEXT,reason TEXT,at INTEGER);
CREATE TABLE IF NOT EXISTS cases(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,type TEXT,target TEXT,moderator TEXT,reason TEXT,at INTEGER);
CREATE TABLE IF NOT EXISTS xp(guild TEXT,user TEXT,xp INTEGER DEFAULT 0,level INTEGER DEFAULT 0,PRIMARY KEY(guild,user));
CREATE TABLE IF NOT EXISTS persistent_roles(guild TEXT,user TEXT,roles TEXT,PRIMARY KEY(guild,user));
CREATE TABLE IF NOT EXISTS birthdays(guild TEXT,user TEXT,month INTEGER,day INTEGER,PRIMARY KEY(guild,user));
CREATE TABLE IF NOT EXISTS custom_commands(guild TEXT,name TEXT,response TEXT,enabled INTEGER DEFAULT 1,role TEXT,channel TEXT,PRIMARY KEY(guild,name));
CREATE TABLE IF NOT EXISTS autoresponders(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,trigger TEXT,response TEXT,match_type TEXT DEFAULT 'contains',enabled INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS sticky(guild TEXT,channel TEXT PRIMARY KEY,message TEXT,last_message TEXT);
CREATE TABLE IF NOT EXISTS reaction_roles(guild TEXT,message TEXT,emoji TEXT,role TEXT,PRIMARY KEY(guild,message,emoji));
CREATE TABLE IF NOT EXISTS temp_roles(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,user TEXT,role TEXT,expires INTEGER);
CREATE TABLE IF NOT EXISTS giveaways(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,channel TEXT,message TEXT,prize TEXT,ends INTEGER,winners INTEGER DEFAULT 1,ended INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS starboard(guild TEXT,message TEXT PRIMARY KEY,star_message TEXT,count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS feeds(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,type TEXT,source TEXT,channel TEXT,last_id TEXT,enabled INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,actor TEXT,action TEXT,details TEXT,at INTEGER);
CREATE TABLE IF NOT EXISTS templates(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,name TEXT,content TEXT);
CREATE TABLE IF NOT EXISTS forms(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,name TEXT,channel TEXT,fields TEXT);
CREATE TABLE IF NOT EXISTS form_submissions(id INTEGER PRIMARY KEY AUTOINCREMENT,form_id INTEGER,guild TEXT,user TEXT,data TEXT,at INTEGER);
CREATE TABLE IF NOT EXISTS factions(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,name TEXT,role TEXT,leader TEXT);
CREATE TABLE IF NOT EXISTS calendar_availability(guild TEXT,user TEXT,day INTEGER,slot TEXT,PRIMARY KEY(guild,user,day));
CREATE TABLE IF NOT EXISTS command_usage(guild TEXT,command TEXT,count INTEGER DEFAULT 0,PRIMARY KEY(guild,command));
`);
const defaults={
 security:{enabled:true,antiNuke:true,antiSpam:true,honeypotChannel:'',honeypotAction:'timeout',logChannel:'',thresholdMs:3500},
 announcements:{welcome:{enabled:false,channel:'',message:'Welcome {user} to **{server}**!',embed:true,title:'Welcome to {server}, {username}! ⚡',description:'Thanks for joining **{server}**!\n\n📌 **Important Directories**\nConfigure your rules, announcements, support, and general channels here.\n\n*You are member #{memberCount} to join! Enjoy your stay.*',thumbnail:'{avatar}',banner:'',color:'#6C3CE1',footer:'SH Protection Shield • Automated Welcome',mention:true,dm:false,dmMessage:'Welcome to **{server}**, {username}!'},leave:{enabled:false,channel:'',message:'{user} left **{server}**.'},ban:{enabled:false,channel:'',message:'{user} was banned.'}},
 roles:{autoRole:'',persistent:false,tagRole:'',colorRoles:[]},
 levels:{enabled:false,minXp:8,maxXp:15,cooldown:60,announce:true,channel:'',roleRewards:{}},
 moderation:{logChannel:'',autoNick:'',badWords:[],inviteFilter:false,mentionLimit:8,warningActions:{3:'timeout',5:'kick'}},
 tickets:{category:'',supportRole:'',logChannel:'',aiDefault:true},
 ai:{enabled:true},
 engagement:{starboard:{enabled:false,channel:'',emoji:'⭐',threshold:3},birthdays:{enabled:false,channel:'',role:''},tempVoice:{enabled:false,lobby:'',category:''},statsChannels:{enabled:false,members:'',bots:'',online:''}},
 messaging:{autoThreads:[],stickyQuietSeconds:5},
 commands:{disabled:[]},
 profile:{nickname:'',avatar:''},
 utilities:{loveCalc:true,minigames:true},
 music:{enabled:true,defaultVolume:80,maxVolume:120,djRole:'',allowedTextChannel:''},
 status:{enabled:true,rotateSeconds:20},
 feeds:{pollMinutes:5}
};
function merge(a,b){for(const[k,v]of Object.entries(b||{})){if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]=merge(a[k]||{},v)}else a[k]=v}return a}

function normalizeGuildId(value){
  if(value===null||value===undefined)throw new TypeError('Guild ID is required');
  if(typeof value==='string'||typeof value==='number'||typeof value==='bigint')return String(value);
  if(value.guild?.id)return String(value.guild.id);
  if(value.guildId)return String(value.guildId);
  if(value.id)return String(value.id);
  throw new TypeError('Invalid guild identifier');
}

function getConfig(guild){guild=normalizeGuildId(guild);let r=db.prepare('SELECT json FROM guild_config WHERE guild=?').get(guild);return merge(structuredClone(defaults),r?JSON.parse(r.json):{})}
function setConfig(guild,c,actor='system',action='config.update'){guild=normalizeGuildId(guild);db.prepare('INSERT INTO guild_config(guild,json,updated) VALUES(?,?,?) ON CONFLICT(guild) DO UPDATE SET json=excluded.json,updated=excluded.updated').run(guild,JSON.stringify(c),Date.now());db.prepare('INSERT INTO audit(guild,actor,action,details,at) VALUES(?,?,?,?,?)').run(guild,actor,action,'Dashboard/settings update',Date.now())}
module.exports={db,getConfig,setConfig,defaults,merge};
