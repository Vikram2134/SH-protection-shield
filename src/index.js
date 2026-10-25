const path=require('path');
require('dotenv').config({path:path.resolve(__dirname,'..','.env')});
const express=require('express'),session=require('express-session'),crypto=require('crypto');
const {Client,GatewayIntentBits,Partials,AuditLogEvent,PermissionsBitField,REST,Routes,SlashCommandBuilder,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,PermissionFlagsBits,MessageFlags}=require('discord.js');
const {db,getConfig,setConfig}=require('./db');
const music=require('./music');
const {startProtectionStatus}=require('./status');
if(!process.env.DISCORD_TOKEN||!process.env.DISCORD_CLIENT_ID){console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env');process.exit(1)}
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildModeration,GatewayIntentBits.GuildWebhooks,GatewayIntentBits.GuildIntegrations,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildMessageReactions,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildPresences],partials:[Partials.GuildMember,Partials.Channel,Partials.Message,Partials.Reaction,Partials.User]});
const bursts=new Map(),made=new Map(),containing=new Set(),xpCd=new Map(),stickyTimers=new Map();
const auditMap=new Map([[AuditLogEvent.ChannelCreate,['CHANNEL_CREATE',2]],[AuditLogEvent.ChannelDelete,['CHANNEL_DELETE',2]],[AuditLogEvent.RoleCreate,['ROLE_CREATE',3]],[AuditLogEvent.RoleDelete,['ROLE_DELETE',2]],[AuditLogEvent.MemberBanAdd,['MASS_BAN',2]],[AuditLogEvent.MemberKick,['MASS_KICK',2]],[AuditLogEvent.WebhookCreate,['WEBHOOK_CREATE',2]],[AuditLogEvent.WebhookDelete,['WEBHOOK_DELETE',2]],[AuditLogEvent.BotAdd,['BOT_ADD',1]],[AuditLogEvent.IntegrationCreate,['INTEGRATION_CREATE',2]],[AuditLogEvent.IntegrationDelete,['INTEGRATION_DELETE',2]],[AuditLogEvent.GuildUpdate,['GUILD_UPDATE',2]]]);
const ef=(content)=>({content,flags:MessageFlags.Ephemeral});
function isTrusted(g,id){return !id||id===g.ownerId||id===client.user?.id||!!db.prepare('SELECT 1 FROM trust WHERE guild=? AND user=?').get(g.id,id)}
function hit(id,t,ms=3500){let k=id+':'+t,n=Date.now(),a=(bursts.get(k)||[]).filter(x=>n-x<ms);a.push(n);bursts.set(k,a);return a.length}
async function log(g,title,text){let guild=typeof g==='string'?client.guilds.cache.get(g):g;if(!guild)return;let c=getConfig(guild.id),id=c.security.logChannel||c.moderation.logChannel;if(id){let ch=guild.channels.cache.get(id);if(ch?.isTextBased())ch.send({embeds:[new EmbedBuilder().setTitle(title).setDescription(text.slice(0,4000)).setTimestamp()]}).catch(()=>{})}console.log(`[${guild.name}] ${title}: ${text}`)}
async function contain(g,id,type,start=Date.now()){if(containing.has(id)||isTrusted(g,id))return;containing.add(id);try{let m=await g.members.fetch(id).catch(()=>null),ms=Date.now()-start;db.prepare('INSERT INTO incidents(guild,executor,type,ms,at) VALUES(?,?,?,?,?)').run(g.id,id,type,ms,Date.now());if(!m?.bannable)return log(g,'🛡️ BLOCKED',`Cannot contain <@${id}> (${type}); check role hierarchy.`);await m.ban({reason:'SH Protection: '+type});let b=made.get(g.id+':'+id);if(b){for(let x of b.c){let c=g.channels.cache.get(x);if(c?.deletable)await c.delete('Raid cleanup').catch(()=>{})}for(let x of b.r){let r=g.roles.cache.get(x);if(r?.editable)await r.delete('Raid cleanup').catch(()=>{})}}await log(g,'🛡️ CONTAINED',`<@${id}> • ${type} • ${ms}ms`)}finally{setTimeout(()=>containing.delete(id),30000)}}
client.on('guildAuditLogEntryCreate',async(e,g)=>{let c=getConfig(g.id);if(!c.security.enabled||!c.security.antiNuke||isTrusted(g,e.executorId))return;let x=auditMap.get(e.action);if(!x)return;let[type,limit]=x,id=e.executorId,target=e.target?.id||e.targetId,start=Date.now(),key=g.id+':'+id;if(!made.has(key))made.set(key,{c:new Set(),r:new Set()});if(type==='CHANNEL_CREATE'&&target)made.get(key).c.add(target);if(type==='ROLE_CREATE'&&target)made.get(key).r.add(target);if(hit(key,type,c.security.thresholdMs)>=limit)await contain(g,id,type,start);if(type==='BOT_ADD'&&target&&!isTrusted(g,target)){let b=await g.members.fetch(target).catch(()=>null);if(b?.bannable)await b.ban({reason:'Unauthorized bot add'}).catch(()=>{})}});
function fmt(t,m,g){let u=m.user||m;return String(t||'').replaceAll('{user}',`<@${u.id||m.id}>`).replaceAll('{username}',u.username||u.tag||m.displayName||'User').replaceAll('{server}',g.name).replaceAll('{members}',String(g.memberCount)).replaceAll('{memberCount}',String(g.memberCount)).replaceAll('{userid}',String(u.id||m.id||'')).replaceAll('{avatar}',u.displayAvatarURL?.({size:256})||'').replaceAll('{serverIcon}',g.iconURL?.({size:256})||'')}
client.on('guildMemberAdd',async m=>{let c=getConfig(m.guild.id),a=c.announcements.welcome;if(a.enabled){let ch=m.guild.channels.cache.get(a.channel);if(ch?.isTextBased()){if(a.embed){let e=new EmbedBuilder().setTitle(fmt(a.title||'Welcome to {server}, {username}!',m,m.guild).slice(0,256)).setDescription(fmt(a.description||a.message,m,m.guild).slice(0,4096)).setTimestamp();let col=String(a.color||'#6C3CE1');if(/^#[0-9a-f]{6}$/i.test(col))e.setColor(col);let thumb=fmt(a.thumbnail,m,m.guild);if(/^https?:\/\//i.test(thumb))e.setThumbnail(thumb);let banner=fmt(a.banner,m,m.guild);if(/^https?:\/\//i.test(banner))e.setImage(banner);let foot=fmt(a.footer,m,m.guild);if(foot)e.setFooter({text:foot.slice(0,2048)});await ch.send({content:a.mention?`<@${m.id}>`:undefined,embeds:[e]}).catch(err=>console.error('[WELCOME]',err.message))}else await ch.send(fmt(a.message,m,m.guild)).catch(()=>{})}if(a.dm){await m.send(fmt(a.dmMessage||a.message,m,m.guild).slice(0,1900)).catch(err=>console.error('[WELCOME DM]',err.message))}}if(c.roles.autoRole){let r=m.guild.roles.cache.get(c.roles.autoRole);if(r?.editable)await m.roles.add(r,'Auto role').catch(()=>{})}if(c.roles.persistent){let p=db.prepare('SELECT roles FROM persistent_roles WHERE guild=? AND user=?').get(m.guild.id,m.id);if(p)for(let id of JSON.parse(p.roles)){let r=m.guild.roles.cache.get(id);if(r?.editable)await m.roles.add(r,'Persistent role restore').catch(()=>{})}}if(c.moderation.autoNick){let nick=fmt(c.moderation.autoNick,m,m.guild).slice(0,32);if(m.manageable)await m.setNickname(nick,'Auto nick').catch(()=>{})}});
client.on('guildMemberRemove',async m=>{let c=getConfig(m.guild.id),a=c.announcements.leave;if(a.enabled){let ch=m.guild.channels.cache.get(a.channel);if(ch?.isTextBased())ch.send(fmt(a.message,m,m.guild)).catch(()=>{})}if(c.roles.persistent){let ids=[...m.roles.cache.keys()].filter(x=>x!==m.guild.id);db.prepare('INSERT OR REPLACE INTO persistent_roles(guild,user,roles) VALUES(?,?,?)').run(m.guild.id,m.id,JSON.stringify(ids))}});
client.on('guildBanAdd',async b=>{let c=getConfig(b.guild.id),a=c.announcements.ban;if(a.enabled){let ch=b.guild.channels.cache.get(a.channel);if(ch?.isTextBased())ch.send(fmt(a.message,b,b.guild)).catch(()=>{})}});
async function ticketAI(m){let t=db.prepare("SELECT * FROM tickets WHERE channel=? AND status='open'").get(m.channel.id),cfg=getConfig(m.guild.id);if(!t||t.ai==='off'||!cfg.ai.enabled)return false;let base=(process.env.OLLAMA_URL||'http://127.0.0.1:11434').replace(/\/$/,''),model=process.env.OLLAMA_MODEL||'qwen3:0.6b';try{await m.channel.sendTyping();let q=await m.channel.messages.fetch({limit:8}),h=[...q.values()].reverse().filter(x=>!x.system&&x.content).map(x=>({role:x.author.id===client.user.id?'assistant':'user',content:x.author.username+': '+x.content.slice(0,700)}));let ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),45000),r=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:ctrl.signal,body:JSON.stringify({model,stream:false,think:false,messages:[{role:'system',content:`You are SH Support AI in ${m.guild.name}. Give short practical support. Never request secrets. Never make moderation/security permission decisions. If server-specific facts are unknown, say staff must confirm.`},...h],options:{num_ctx:2048,num_predict:180,temperature:.3}})});clearTimeout(timer);if(!r.ok)throw Error('Ollama HTTP '+r.status);let d=await r.json(),text=d.message?.content?.trim();if(text)await m.reply(text.slice(0,1900));return true}catch(e){console.error('[AI]',e.message);return false}}
function levelFor(xp){return Math.floor(Math.sqrt(xp/50))}
client.on('messageCreate',async m=>{if(!m.guild||m.author.bot)return;let c=getConfig(m.guild.id);if(await ticketAI(m))return;
 // Honeypot
 if(c.security.honeypotChannel===m.channel.id&&!isTrusted(m.guild,m.author.id)){await m.delete().catch(()=>{});let mem=m.member;if(c.security.honeypotAction==='ban'&&mem?.bannable)await mem.ban({reason:'Honeypot triggered'}).catch(()=>{});else if(mem?.moderatable)await mem.timeout(10*60*1000,'Honeypot triggered').catch(()=>{});return log(m.guild,'🍯 Honeypot',`${m.author} triggered honeypot`)}
 // AutoMod
 let low=m.content.toLowerCase();if(c.moderation.badWords.some(w=>w&&low.includes(String(w).toLowerCase()))||(c.moderation.inviteFilter&&/discord(?:\.gg|\.com\/invite)\//i.test(m.content))||m.mentions.users.size>=c.moderation.mentionLimit){await m.delete().catch(()=>{});return log(m.guild,'AutoMod',`Removed message from ${m.author}`)}
 // Anti spam
 if(c.security.enabled&&c.security.antiSpam&&!isTrusted(m.guild,m.author.id)){let n=Date.now(),key=m.guild.id+':'+m.author.id,a=(bursts.get('spam:'+key)||[]).filter(x=>n-x<3500);a.push(n);bursts.set('spam:'+key,a);if(a.length>=7){if(m.member?.moderatable)await m.member.timeout(5*60*1000,'Message flood').catch(()=>{});return}}
 // Auto responders
 for(let r of db.prepare('SELECT * FROM autoresponders WHERE guild=? AND enabled=1').all(m.guild.id)){let ok=r.match_type==='exact'?low===r.trigger.toLowerCase():low.includes(r.trigger.toLowerCase());if(ok){await m.reply(r.response.slice(0,1900)).catch(()=>{});break}}
 // Custom prefix commands
 if(m.content.startsWith('!')){let name=m.content.slice(1).trim().split(/\s+/)[0].toLowerCase(),r=db.prepare('SELECT * FROM custom_commands WHERE guild=? AND name=? AND enabled=1').get(m.guild.id,name);if(r&&(!r.role||m.member.roles.cache.has(r.role))&&(!r.channel||m.channel.id===r.channel)){db.prepare('INSERT INTO command_usage(guild,command,count) VALUES(?,?,1) ON CONFLICT(guild,command) DO UPDATE SET count=count+1').run(m.guild.id,'!'+name);await m.reply(r.response.slice(0,1900)).catch(()=>{})}}
 // XP
 if(c.levels.enabled){let key=m.guild.id+':'+m.author.id,n=Date.now();if(n-(xpCd.get(key)||0)>c.levels.cooldown*1000){xpCd.set(key,n);let add=Math.floor(Math.random()*(c.levels.maxXp-c.levels.minXp+1))+c.levels.minXp,row=db.prepare('SELECT xp,level FROM xp WHERE guild=? AND user=?').get(m.guild.id,m.author.id)||{xp:0,level:0},xp=row.xp+add,lvl=levelFor(xp);db.prepare('INSERT INTO xp(guild,user,xp,level) VALUES(?,?,?,?) ON CONFLICT(guild,user) DO UPDATE SET xp=excluded.xp,level=excluded.level').run(m.guild.id,m.author.id,xp,lvl);if(lvl>row.level&&c.levels.announce){let ch=m.guild.channels.cache.get(c.levels.channel)||m.channel;ch.send(`🎉 ${m.author} reached **level ${lvl}**!`).catch(()=>{});let rr=c.levels.roleRewards[String(lvl)];if(rr&&m.member)await m.member.roles.add(rr).catch(()=>{})}}}
 // Auto threads
 if(c.messaging.autoThreads.includes(m.channel.id)&&m.startThread)await m.startThread({name:`Discussion • ${m.author.username}`.slice(0,90),autoArchiveDuration:60}).catch(()=>{});
 // Sticky
 let st=db.prepare('SELECT * FROM sticky WHERE guild=? AND channel=?').get(m.guild.id,m.channel.id);if(st){clearTimeout(stickyTimers.get(m.channel.id));stickyTimers.set(m.channel.id,setTimeout(async()=>{if(st.last_message){let old=await m.channel.messages.fetch(st.last_message).catch(()=>null);if(old?.deletable)await old.delete().catch(()=>{})}let x=await m.channel.send(st.message).catch(()=>null);if(x)db.prepare('UPDATE sticky SET last_message=? WHERE channel=?').run(x.id,m.channel.id)},Math.max(3,c.messaging.stickyQuietSeconds)*1000))}
});
client.on('messageReactionAdd',async(reaction,user)=>{if(user.bot)return;if(reaction.partial)await reaction.fetch().catch(()=>{});let m=reaction.message,g=m.guild;if(!g)return;let key=reaction.emoji.id||reaction.emoji.name,rr=db.prepare('SELECT role FROM reaction_roles WHERE guild=? AND message=? AND emoji=?').get(g.id,m.id,key);if(rr){let mem=await g.members.fetch(user.id).catch(()=>null);if(mem)await mem.roles.add(rr.role).catch(()=>{})}let c=getConfig(g.id),s=c.engagement.starboard;if(s.enabled&&key===s.emoji&&reaction.count>=s.threshold){let ch=g.channels.cache.get(s.channel);if(ch?.isTextBased()&&!db.prepare('SELECT 1 FROM starboard WHERE guild=? AND message=?').get(g.id,m.id)){let sm=await ch.send({embeds:[new EmbedBuilder().setAuthor({name:m.author.tag,iconURL:m.author.displayAvatarURL()}).setDescription(m.content||'[attachment]').addFields({name:'Source',value:`[Jump](${m.url})`}).setFooter({text:`${reaction.count} ${s.emoji}`})]});db.prepare('INSERT INTO starboard(guild,message,star_message,count) VALUES(?,?,?,?)').run(g.id,m.id,sm.id,reaction.count)}}});
client.on('messageReactionRemove',async(reaction,user)=>{if(user.bot)return;if(reaction.partial)await reaction.fetch().catch(()=>{});let g=reaction.message.guild;if(!g)return;let key=reaction.emoji.id||reaction.emoji.name,rr=db.prepare('SELECT role FROM reaction_roles WHERE guild=? AND message=? AND emoji=?').get(g.id,reaction.message.id,key);if(rr){let mem=await g.members.fetch(user.id).catch(()=>null);if(mem)await mem.roles.remove(rr.role).catch(()=>{})}});
client.on('voiceStateUpdate',async(o,n)=>{let g=n.guild,c=getConfig(g.id),tv=c.engagement.tempVoice;if(tv.enabled&&n.channelId===tv.lobby){let ch=await g.channels.create({name:`${n.member.displayName}'s room`,type:ChannelType.GuildVoice,parent:tv.category||n.channel.parentId});await n.setChannel(ch).catch(()=>{})}if(o.channel&&o.channel.id!==tv.lobby&&o.channel.members.size===0&&o.channel.parentId===(tv.category||o.channel.parentId)&&o.channel.name.endsWith("'s room"))await o.channel.delete('Temporary voice empty').catch(()=>{})});
async function createTicket(i){let c=getConfig(i.guild.id),n=db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM tickets').get().n,ow=[{id:i.guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},{id:i.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}];let sr=c.tickets.supportRole?i.guild.roles.cache.get(c.tickets.supportRole):null;if(sr)ow.push({id:sr.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]});let cat=c.tickets.category?i.guild.channels.cache.get(c.tickets.category):null;if(cat&&cat.type!==ChannelType.GuildCategory)cat=null;let ch=await i.guild.channels.create({name:`ticket-${String(n).padStart(4,'0')}`,type:ChannelType.GuildText,parent:cat?.id||undefined,permissionOverwrites:ow});db.prepare('INSERT INTO tickets(guild,channel,opener,ai,at) VALUES(?,?,?,?,?)').run(i.guild.id,ch.id,i.user.id,c.tickets.aiDefault?'assist':'off',Date.now());let row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('claim').setLabel('Claim').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('aitoggle').setLabel(c.tickets.aiDefault?'AI: ON':'AI: OFF').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('close').setLabel('Close').setStyle(ButtonStyle.Danger));await ch.send({content:`<@${i.user.id}>`,embeds:[new EmbedBuilder().setTitle('🎫 SH Support').setDescription('Describe your issue. Never send passwords, tokens, API keys, private keys, or payment credentials.')],components:[row]});return i.reply(ef(`Created ${ch}`))}
const commands=[new SlashCommandBuilder().setName('panel').setDescription('SH Protection quick panel'),new SlashCommandBuilder().setName('dashboard').setDescription('Get dashboard link'),new SlashCommandBuilder().setName('ticket-panel').setDescription('Post ticket panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),new SlashCommandBuilder().setName('trust').setDescription('Trust a user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),new SlashCommandBuilder().setName('untrust').setDescription('Untrust a user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),new SlashCommandBuilder().setName('warn').setDescription('Warn a member').addUserOption(o=>o.setName('user').setDescription('Member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),new SlashCommandBuilder().setName('rank').setDescription('View your rank'),new SlashCommandBuilder().setName('leaderboard').setDescription('XP leaderboard'),new SlashCommandBuilder().setName('birthday').setDescription('Set birthday').addIntegerOption(o=>o.setName('month').setDescription('1-12').setRequired(true).setMinValue(1).setMaxValue(12)).addIntegerOption(o=>o.setName('day').setDescription('1-31').setRequired(true).setMinValue(1).setMaxValue(31)),new SlashCommandBuilder().setName('love').setDescription('Fun compatibility score').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)),new SlashCommandBuilder().setName('guess').setDescription('Mini guess game'),
new SlashCommandBuilder().setName('play').setDescription('Play or queue a song').addStringOption(o=>o.setName('query').setDescription('Song name or supported URL').setRequired(true)),
new SlashCommandBuilder().setName('pause').setDescription('Pause the current song'),
new SlashCommandBuilder().setName('resume').setDescription('Resume the current song'),
new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
new SlashCommandBuilder().setName('stop').setDescription('Stop music and leave voice'),
new SlashCommandBuilder().setName('queue').setDescription('Show the music queue'),
new SlashCommandBuilder().setName('volume').setDescription('Set music volume').addIntegerOption(o=>o.setName('percent').setDescription('0-150').setRequired(true).setMinValue(0).setMaxValue(150))
].map(x=>x.toJSON());

function isGuildOwnerInteraction(i){return !!i.guild&&i.user.id===i.guild.ownerId}
function hasGuildPermission(i,perm){return !!i.memberPermissions?.has(perm)}
function supportMember(i,c){
 if(!i.member)return false;
 return isGuildOwnerInteraction(i)||hasGuildPermission(i,PermissionFlagsBits.ManageGuild)||
   (!!c.tickets.supportRole&&i.member.roles?.cache?.has(c.tickets.supportRole));
}

client.on('interactionCreate',async i=>{try{if(i.isChatInputCommand()){db.prepare('INSERT INTO command_usage(guild,command,count) VALUES(?,?,1) ON CONFLICT(guild,command) DO UPDATE SET count=count+1').run(i.guildId,i.commandName);let c=getConfig(i.guildId);if(c.commands.disabled.includes(i.commandName))return i.reply(ef('This command is disabled on this server.'));
if(['play','pause','resume','skip','stop','queue','volume'].includes(i.commandName)){
 if(!c.music?.enabled)return i.reply(ef('Music is disabled on this server.'));
 if(c.music.allowedTextChannel&&i.channelId!==c.music.allowedTextChannel)return i.reply(ef(`Use music commands in <#${c.music.allowedTextChannel}>.`));
 if(c.music.djRole&&!i.member.roles.cache.has(c.music.djRole)&&!i.memberPermissions.has(PermissionFlagsBits.ManageGuild))return i.reply(ef('You need the configured DJ role to control music.'));
 if(i.commandName==='queue')return i.reply({content:music.queueText(i.guildId),flags:MessageFlags.Ephemeral});
 if(i.commandName==='volume'){
   const max=Math.min(150,Number(c.music.maxVolume||120)),v=Math.min(i.options.getInteger('percent'),max);
   music.setVolume(i.guildId,v);return i.reply(ef(`🔊 Volume set to ${v}%.`));
 }
 if(i.commandName==='stop'){await music.stop(i.guildId);return i.reply(ef('⏹️ Music stopped.'))}
 const st=music.state(i.guildId);
 if(!i.member.voice.channelId||st.connection?.joinConfig?.channelId&&st.connection.joinConfig.channelId!==i.member.voice.channelId)return i.reply(ef('Join my voice channel first.'));
 if(i.commandName==='pause'){st.player?.pause();st.paused=true;return i.reply(ef('⏸️ Paused.'))}
 if(i.commandName==='resume'){st.player?.unpause();st.paused=false;return i.reply(ef('▶️ Resumed.'))}
 if(i.commandName==='skip'){st.skipRequested=true;st.player?.stop();return i.reply(ef('⏭️ Skipped.'))}
 if(i.commandName==='play'){await i.deferReply();try{await music.playCommand(i,i.options.getString('query'));}catch(e){return i.editReply('❌ '+e.message)}return;}
}if(i.commandName==='dashboard')return i.reply(ef(`${process.env.DASHBOARD_URL||'http://localhost:3000'}/dashboard`));if(i.commandName==='panel')return i.reply({embeds:[new EmbedBuilder().setTitle('🛡️ SH Protection V6').setDescription(`Protection: ${c.security.enabled?'🟢 ON':'🔴 OFF'}\nAI: ${c.ai.enabled?'🟢 ON':'🔴 OFF'}\nDashboard: ${process.env.DASHBOARD_URL||'http://localhost:3000'}`)],flags:MessageFlags.Ephemeral});if(i.commandName==='ticket-panel'){
 if(!hasGuildPermission(i,PermissionFlagsBits.ManageGuild))return i.reply(ef('❌ You need Manage Server to post the ticket panel.'));
 let row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticketopen').setLabel('Open Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary));
 await i.channel.send({embeds:[new EmbedBuilder().setTitle('🎫 Support').setDescription('Press below to create a private ticket.')],components:[row]});
 return i.reply(ef('Ticket panel posted.'));
}
if(i.commandName==='trust'||i.commandName==='untrust'){
 if(!isGuildOwnerInteraction(i))return i.reply(ef('❌ Only the server owner can manage trusted users.'));
 let u=i.options.getUser('user');
 if(u.bot)return i.reply(ef('❌ Bots cannot be added to the trusted-user list from this command.'));
 if(i.commandName==='trust')db.prepare('INSERT OR REPLACE INTO trust(guild,user) VALUES(?,?)').run(i.guildId,u.id);
 else db.prepare('DELETE FROM trust WHERE guild=? AND user=?').run(i.guildId,u.id);
 db.prepare('INSERT INTO audit(guild,actor,action,details,at) VALUES(?,?,?,?,?)').run(i.guildId,i.user.id,'security.'+i.commandName,u.id,Date.now());
 return i.reply(ef(`${i.commandName==='trust'?'✅ Trusted':'🔒 Untrusted'} ${u}`));
}
if(i.commandName==='warn'){
 if(!hasGuildPermission(i,PermissionFlagsBits.ModerateMembers))return i.reply(ef('❌ You need Moderate Members to use /warn.'));
 let u=i.options.getUser('user'),r=i.options.getString('reason');db.prepare('INSERT INTO warnings(guild,user,moderator,reason,at) VALUES(?,?,?,?,?)').run(i.guildId,u.id,i.user.id,r,Date.now());let count=db.prepare('SELECT COUNT(*) c FROM warnings WHERE guild=? AND user=?').get(i.guildId,u.id).c;db.prepare('INSERT INTO cases(guild,type,target,moderator,reason,at) VALUES(?,?,?,?,?,?)').run(i.guildId,'WARN',u.id,i.user.id,r,Date.now());return i.reply(`⚠️ ${u} warned (${count}). Reason: ${r}`)}if(i.commandName==='rank'){let r=db.prepare('SELECT * FROM xp WHERE guild=? AND user=?').get(i.guildId,i.user.id)||{xp:0,level:0};return i.reply(`⭐ ${i.user}: Level **${r.level}** • **${r.xp} XP**`)}if(i.commandName==='leaderboard'){let a=db.prepare('SELECT * FROM xp WHERE guild=? ORDER BY xp DESC LIMIT 10').all(i.guildId);return i.reply({embeds:[new EmbedBuilder().setTitle('🏆 Leaderboard').setDescription(a.map((x,j)=>`**${j+1}.** <@${x.user}> — Lv.${x.level} • ${x.xp} XP`).join('\n')||'No XP yet.')]})}if(i.commandName==='birthday'){db.prepare('INSERT OR REPLACE INTO birthdays(guild,user,month,day) VALUES(?,?,?,?)').run(i.guildId,i.user.id,i.options.getInteger('month'),i.options.getInteger('day'));return i.reply(ef('🎂 Birthday saved.'))}if(i.commandName==='love'){if(!c.utilities.loveCalc)return i.reply(ef('LoveCalc is disabled.'));let u=i.options.getUser('user'),pair=[i.user.id,u.id].sort().join(':'),score=parseInt(crypto.createHash('sha256').update(pair).digest('hex').slice(0,4),16)%101;return i.reply(`💗 ${i.user} + ${u} = **${score}%**`)}if(i.commandName==='guess'){if(!c.utilities.minigames)return i.reply(ef('Mini games are disabled.'));let n=Math.floor(Math.random()*5)+1;return i.reply(`🎮 I'm thinking of a number from 1–5. This round it was **${n}**!`)}}
 if(!i.isButton())return;
 if(await music.handleButton(i))return;
 if(i.customId==='ticketopen')return createTicket(i);
 let t=db.prepare("SELECT * FROM tickets WHERE channel=? AND status='open'").get(i.channelId);
 if(!t)return;
 let tc=getConfig(i.guildId),staff=supportMember(i,tc),opener=i.user.id===t.opener;
 if(i.customId==='claim'){
  if(!staff)return i.reply(ef('❌ Only configured support staff can claim tickets.'));
  db.prepare('UPDATE tickets SET claimed=? WHERE id=?').run(i.user.id,t.id);return i.reply(`Claimed by ${i.user}`);
 }
 if(i.customId==='aitoggle'){
  if(!staff)return i.reply(ef('❌ Only support staff can change ticket AI mode.'));
  let on=t.ai==='off';db.prepare('UPDATE tickets SET ai=? WHERE id=?').run(on?'assist':'off',t.id);return i.reply(ef(`AI is now ${on?'ON':'OFF'}.`));
 }
 if(i.customId==='close'){
  if(!staff&&!opener)return i.reply(ef('❌ You cannot close this ticket.'));
  db.prepare("UPDATE tickets SET status='closed' WHERE id=?").run(t.id);await i.reply('Closing in 5 seconds.');setTimeout(()=>i.channel.delete().catch(()=>{}),5000);
 }
}catch(e){console.error(e);if(i.isRepliable()&&!i.replied)await i.reply(ef('Internal error.')).catch(()=>{})}});
// Scheduled jobs: temp roles, birthdays, giveaways, stats channels, feeds
setInterval(async()=>{let now=Date.now();for(let x of db.prepare('SELECT * FROM temp_roles WHERE expires<=?').all(now)){let g=client.guilds.cache.get(x.guild),m=await g?.members.fetch(x.user).catch(()=>null);if(m)await m.roles.remove(x.role,'Temporary role expired').catch(()=>{});db.prepare('DELETE FROM temp_roles WHERE id=?').run(x.id)}for(let g of client.guilds.cache.values()){let c=getConfig(g.id),s=c.engagement.statsChannels;if(s.enabled){let members=g.memberCount,bots=g.members.cache.filter(m=>m.user.bot).size,vals=[[s.members,`Members: ${members}`],[s.bots,`Bots: ${bots}`]];for(let[id,name]of vals){let ch=g.channels.cache.get(id);if(ch&&ch.name!==name)await ch.setName(name).catch(()=>{})}}}},60000);
setInterval(async()=>{let d=new Date(),mo=d.getMonth()+1,day=d.getDate();for(let g of client.guilds.cache.values()){let c=getConfig(g.id),b=c.engagement.birthdays;if(!b.enabled)continue;let ch=g.channels.cache.get(b.channel);if(!ch?.isTextBased())continue;for(let x of db.prepare('SELECT user FROM birthdays WHERE guild=? AND month=? AND day=?').all(g.id,mo,day)){ch.send(`🎂 Happy birthday <@${x.user}>!`).catch(()=>{});if(b.role){let m=await g.members.fetch(x.user).catch(()=>null);if(m)await m.roles.add(b.role).catch(()=>{})}}}},24*60*60*1000);
// Dashboard
const app=express();app.use(express.urlencoded({extended:true,limit:'1mb'}));app.use(express.json({limit:'1mb'}));app.use(express.static('public'));app.use(session({secret:process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax'}}));
const base=()=>String(process.env.DASHBOARD_URL||`http://localhost:${process.env.PORT||3000}`).replace(/\/$/,'');
const oauthRedirect=()=>process.env.OAUTH_REDIRECT_URI||base()+'/callback';
app.get('/login',(req,res)=>{let state=crypto.randomBytes(16).toString('hex');req.session.oauthState=state;let q=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,response_type:'code',redirect_uri:oauthRedirect(),scope:'identify guilds',state});res.redirect('https://discord.com/oauth2/authorize?'+q)});
app.get('/callback',async(req,res)=>{
 if(req.query.error)return res.status(400).send('Discord OAuth was cancelled or denied.');
 if(!req.query.code)return res.status(400).send('OAuth failed: missing authorization code. Start again from /login.');
 if(!req.session.oauthState||req.query.state!==req.session.oauthState)return res.status(403).send('Invalid OAuth state. Start login again.');
 if(!process.env.DISCORD_CLIENT_SECRET)return res.status(500).send('OAuth is not configured: DISCORD_CLIENT_SECRET is missing from .env.');
 try{
  const body=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code:String(req.query.code),redirect_uri:oauthRedirect()});
  const tok=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
  const raw=await tok.text(); let t={}; try{t=JSON.parse(raw)}catch{}
  if(!tok.ok||!t.access_token){
   const safe=t.error_description||t.message||t.error||('HTTP '+tok.status);
   console.error(`[OAuth] Token exchange failed | status=${tok.status} | error=${safe} | redirect=${oauthRedirect()} | client=${process.env.DISCORD_CLIENT_ID}`);
   return res.status(502).send('OAuth token exchange failed: '+String(safe).replace(/[<>]/g,''));
  }
  const h={Authorization:'Bearer '+t.access_token};
  const [ur,gr]=await Promise.all([fetch('https://discord.com/api/v10/users/@me',{headers:h}),fetch('https://discord.com/api/v10/users/@me/guilds',{headers:h})]);
  if(!ur.ok||!gr.ok)throw Error(`Discord profile request failed (${ur.status}/${gr.status})`);
  const [u,gs]=await Promise.all([ur.json(),gr.json()]);
  req.session.user=u;req.session.guilds=gs;delete req.session.oauthState;
  req.session.save(err=>err?res.status(500).send('OAuth session save failed.'):res.redirect('/dashboard'));
 }catch(e){console.error('[OAuth]',e.message);res.status(500).send('OAuth failed: '+e.message)}
});
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));
function auth(req,res,next){if(!req.session.user)return res.redirect('/login');next()}
function allowed(req,gid){let global=(process.env.GLOBAL_ADMINS||'').split(',').includes(req.session.user.id),x=(req.session.guilds||[]).find(g=>g.id===gid),manage=x&&(BigInt(x.permissions)&32n)!==0n;return global||manage}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function layout(title,user,body,gid=''){return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)} • SH Protection</title><link rel=stylesheet href=/app.css></head><body><aside><div class=brand>🛡️ <b>SH PROTECTION</b><small>V6 • FREE</small></div><nav><a href=/dashboard>🏠 Overview</a>${gid?`<a href=/g/${gid}/general>⚙️ General</a><a href=/g/${gid}/messaging>💬 Messaging</a><a href=/g/${gid}/engagement>⭐ Engagement</a><a href=/g/${gid}/music>🎵 Music</a><a href=/g/${gid}/roles>🎭 Roles</a><a href=/g/${gid}/moderation>🔨 Moderation</a><a href=/g/${gid}/security>🛡️ Security</a><a href=/g/${gid}/feeds>📡 Social Feeds</a><a href=/g/${gid}/ai>🤖 AI</a><a href=/g/${gid}/data>📋 Data & Logs</a>`:''}</nav><div class=user>${user?esc(user.username):'Guest'}<br><a href=/logout>Sign out</a></div></aside><main><header><h1>${esc(title)}</h1>${gid?`<span class=badge>${esc(client.guilds.cache.get(gid)?.name||'Server')}</span>`:''}</header>${body}</main></body></html>`}
app.get('/',(req,res)=>res.send(layout('SH Protection Shield',req.session.user,`<section class=hero><h2>Security + Community Management</h2><p>Anti-nuke, tickets, moderation, levels, roles, announcements, feeds and local AI — no premium locks.</p><a class=btn href=${req.session.user?'/dashboard':'/login'}>${req.session.user?'Open Dashboard':'Login with Discord'}</a></section>`)));
app.get('/dashboard',auth,(req,res)=>{let gs=(req.session.guilds||[]).filter(g=>allowed(req,g.id)&&client.guilds.cache.has(g.id)),cards=gs.map(g=>`<a class=server href=/g/${g.id}/general><b>${esc(g.name)}</b><span>${client.guilds.cache.get(g.id)?.memberCount||0} members</span><em>Manage →</em></a>`).join('');res.send(layout('Your Servers',req.session.user,`<div class=grid>${cards||'<div class=card>Invite the bot to a server you manage, then refresh.</div>'}</div>`))});
function guildRoute(req,res,next){if(!allowed(req,req.params.gid)||!client.guilds.cache.has(req.params.gid))return res.status(403).send('You cannot manage this server.');req.guild=client.guilds.cache.get(req.params.gid);req.cfg=getConfig(req.params.gid);next()}
function ownerOnly(req,res,next){if(req.session.user.id!==req.guild.ownerId)return res.status(403).send('Only the Discord server owner can change security/trusted-user settings.');next()}
function prettyLabel(k){return k.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase())}
function channelOptions(g,value,kind='text'){
 let arr=[...g.channels.cache.values()].filter(ch=>{
  if(kind==='category')return ch.type===ChannelType.GuildCategory;
  if(kind==='voice')return ch.type===ChannelType.GuildVoice;
  return ch.isTextBased()&&ch.type!==ChannelType.GuildCategory;
 }).sort((a,b)=>(a.position||0)-(b.position||0));
 return `<option value="">Not configured</option>`+arr.map(ch=>`<option value="${ch.id}" ${ch.id===value?'selected':''}>${esc(kind==='category'?'📁 ':'# ')}${esc(ch.name)}</option>`).join('');
}
function roleOptions(g,value){
 return `<option value="">Not configured</option>`+[...g.roles.cache.values()].filter(r=>r.id!==g.id&&!r.managed).sort((a,b)=>b.position-a.position).map(r=>`<option value="${r.id}" ${r.id===value?'selected':''}>@${esc(r.name)}</option>`).join('');
}
function selectorKind(path){
 if(/tickets\.category$|tempVoice\.category$/.test(path))return 'category';
 if(/tempVoice\.lobby$|statsChannels\.(members|bots|online)$/.test(path))return 'voice';
 if(/supportRole$|autoRole$|tagRole$|birthdays\.role$/.test(path))return 'role';
 if(/channel$/i.test(path)||/Channel$/.test(path))return 'text';
 return '';
}
function fields(obj,prefix='',g=null){
 let out='';
 for(let[k,v]of Object.entries(obj)){
  let name=prefix?prefix+'.'+k:k,label=prettyLabel(k);
  if(v&&typeof v==='object'&&!Array.isArray(v)){
   out+=`<fieldset><legend>${esc(label)}</legend>${fields(v,name,g)}</fieldset>`;
  }else if(Array.isArray(v)){
   out+=`<label>${esc(label)}<textarea name="${esc(name)}">${esc(v.join('\n'))}</textarea><small>One item per line</small></label>`;
  }else if(typeof v==='boolean'){
   out+=`<label class="switchrow"><span><b>${esc(label)}</b></span><input type=checkbox name="${esc(name)}" ${v?'checked':''}></label>`;
  }else{
   let kind=selectorKind(name);
   if(g&&kind==='role')out+=`<label>${esc(label)}<select name="${esc(name)}">${roleOptions(g,String(v||''))}</select></label>`;
   else if(g&&kind)out+=`<label>${esc(label)}<select name="${esc(name)}">${channelOptions(g,String(v||''),kind)}</select></label>`;
   else if(typeof v==='number')out+=`<label>${esc(label)}<input type=number name="${esc(name)}" value="${esc(v)}"></label>`;
   else out+=`<label>${esc(label)}<input name="${esc(name)}" value="${esc(v)}"></label>`;
  }
 }
 return out;
}
function setPath(o,path,val){let a=path.split('.'),x=o;for(let i=0;i<a.length-1;i++)x=x[a[i]]??={};x[a.at(-1)]=val}
function parseLike(old,raw,checked){if(typeof old==='boolean')return checked;if(Array.isArray(old))return String(raw||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(typeof old==='number')return Number(raw)||0;return String(raw??'')}
function flatten(o,p='',r={}){for(let[k,v]of Object.entries(o)){let n=p?p+'.'+k:k;if(v&&typeof v==='object'&&!Array.isArray(v))flatten(v,n,r);else r[n]=v}return r}
function saveSection(req,section){let c=req.cfg,flat=flatten(c[section]);for(let[path,old]of Object.entries(flat)){let full=section+'.'+path,raw=req.body[full],checked=Object.hasOwn(req.body,full);setPath(c,full,parseLike(old,raw,checked))}setConfig(req.params.gid,c,req.session.user.id,'dashboard.'+section)}
const sections={general:['General Settings',['announcements','profile','commands','utilities']],messaging:['Messaging',['messaging','tickets']],engagement:['Server Engagement',['levels','engagement']],music:['Music',['music','status']],roles:['Roles',['roles']],moderation:['Moderation',['moderation']],security:['Security',['security']],feeds:['Social Feeds',['feeds']],ai:['AI',['ai','tickets']]};
for(let[slug,[title,parts]]of Object.entries(sections)){
 let guards=slug==='security'?[auth,guildRoute,ownerOnly]:[auth,guildRoute];
 app.get('/g/:gid/'+slug,...guards,(req,res)=>{
  let form=parts.map(p=>`<div class=card><h2>${esc(prettyLabel(p))}</h2>${fields(req.cfg[p],p,req.guild)}</div>`).join('');
  let saved=req.query.saved?'<div class="notice ok">✓ Settings saved. The bot reads the new configuration immediately.</div>':'';
  let actions='';
  if(slug==='general')actions=`<div class=card><h2>Announcement Tests</h2><p class=muted>Send a test using the currently saved welcome/leave/ban channel.</p><div class=actions><button formaction="/g/${req.params.gid}/test-announcement/welcome" formmethod=post>Test Welcome</button><button formaction="/g/${req.params.gid}/test-announcement/leave" formmethod=post>Test Leave</button><button formaction="/g/${req.params.gid}/test-announcement/ban" formmethod=post>Test Ban</button></div></div>`;
  if(slug==='messaging')actions=`<div class=card><h2>Ticket Panel</h2><p class=muted>Post a working ticket panel to a Discord text channel.</p><label>Panel Channel<select name="panelChannel">${channelOptions(req.guild,'','text')}</select></label><button formaction="/g/${req.params.gid}/post-ticket-panel" formmethod=post>Post Ticket Panel</button></div>`;
  res.send(layout(title,req.session.user,`${saved}<form method=post>${form}<div class=savebar><button class=btn>Save Changes</button><span>Changes are stored per server.</span></div>${actions}</form>`,req.params.gid));
 });
 app.post('/g/:gid/'+slug,...guards,(req,res)=>{for(let p of parts)saveSection(req,p);res.redirect('/g/'+req.params.gid+'/'+slug+'?saved=1')});
}

app.post('/g/:gid/test-announcement/:type',auth,guildRoute,async(req,res)=>{
 let type=req.params.type,c=getConfig(req.params.gid),a=c.announcements[type];
 if(!['welcome','leave','ban'].includes(type)||!a)return res.status(400).send('Unknown announcement type.');
 if(!a.channel)return res.status(400).send('Choose and save an announcement channel first.');
 let ch=req.guild.channels.cache.get(a.channel);
 if(!ch?.isTextBased())return res.status(400).send('Configured announcement channel is unavailable.');
 let fake={id:req.session.user.id,user:{id:req.session.user.id,username:req.session.user.username}};
 if(type==='welcome'&&a.embed){let e=new EmbedBuilder().setTitle(fmt(a.title||'Welcome to {server}, {username}!',fake,req.guild).slice(0,256)).setDescription(fmt(a.description||a.message,fake,req.guild).slice(0,4096));let col=String(a.color||'#6C3CE1');if(/^#[0-9a-f]{6}$/i.test(col))e.setColor(col);let thumb=fmt(a.thumbnail,fake,req.guild);if(/^https?:\/\//i.test(thumb))e.setThumbnail(thumb);let banner=fmt(a.banner,fake,req.guild);if(/^https?:\/\//i.test(banner))e.setImage(banner);let foot=fmt(a.footer,fake,req.guild);if(foot)e.setFooter({text:foot.slice(0,2048)});await ch.send({content:'🧪 **Dashboard welcome test**',embeds:[e]})}else await ch.send('🧪 **Dashboard test**\n'+fmt(a.message,fake,req.guild)).catch(e=>{throw e});
 db.prepare('INSERT INTO audit(guild,actor,action,details,at) VALUES(?,?,?,?,?)').run(req.params.gid,req.session.user.id,'dashboard.test.'+type,a.channel,Date.now());
 res.redirect('/g/'+req.params.gid+'/general?saved=1');
});
app.post('/g/:gid/post-ticket-panel',auth,guildRoute,async(req,res)=>{
 let id=String(req.body.panelChannel||''),ch=req.guild.channels.cache.get(id);
 if(!ch?.isTextBased())return res.status(400).send('Select a valid text channel.');
 let row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticketopen').setLabel('Open Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary));
 await ch.send({embeds:[new EmbedBuilder().setTitle('🎫 Support').setDescription('Press below to create a private ticket.')],components:[row]});
 db.prepare('INSERT INTO audit(guild,actor,action,details,at) VALUES(?,?,?,?,?)').run(req.params.gid,req.session.user.id,'dashboard.ticket-panel',id,Date.now());
 res.redirect('/g/'+req.params.gid+'/messaging?saved=1');
});
app.get('/g/:gid/data',auth,guildRoute,(req,res)=>{let gid=req.params.gid,inc=db.prepare('SELECT * FROM incidents WHERE guild=? ORDER BY id DESC LIMIT 20').all(gid),cases=db.prepare('SELECT * FROM cases WHERE guild=? ORDER BY id DESC LIMIT 20').all(gid),aud=db.prepare('SELECT * FROM audit WHERE guild=? ORDER BY id DESC LIMIT 30').all(gid),trust=db.prepare('SELECT user FROM trust WHERE guild=?').all(gid),cmds=db.prepare('SELECT * FROM custom_commands WHERE guild=?').all(gid),ar=db.prepare('SELECT * FROM autoresponders WHERE guild=?').all(gid);let table=(a,cols)=>`<table><thead><tr>${cols.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${a.map(x=>`<tr>${cols.map(k=>`<td>${esc(x[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;res.send(layout('Data & Logs',req.session.user,`<div class=card><h2>Trusted Users</h2><p class=muted>Only the Discord server owner can change this list. Trusted users bypass anti-nuke enforcement.</p>${table(trust,['user'])}${req.session.user.id===req.guild.ownerId?`<form method=post action=/g/${gid}/trust><label>User ID<input name=user placeholder="Discord user ID" required></label><button>Add Trusted User</button></form><form method=post action=/g/${gid}/untrust><label>User ID<input name=user placeholder="Discord user ID" required></label><button class=danger>Remove Trusted User</button></form>`:'<div class="notice">View only — server owner access required to edit.</div>'}</div><div class=card><h2>Custom Commands</h2>${table(cmds,['name','response','enabled'])}<form method=post action=/g/${gid}/custom-command><input name=name placeholder="command without !" required><input name=response placeholder="response" required><button>Add / Update</button></form></div><div class=card><h2>Auto Responders</h2>${table(ar,['trigger','response','match_type','enabled'])}<form method=post action=/g/${gid}/autoresponder><input name=trigger placeholder="trigger" required><input name=response placeholder="response" required><select name=match_type><option>contains</option><option>exact</option></select><button>Add</button></form></div><div class=card><h2>Incidents</h2>${table(inc,['id','executor','type','ms','at'])}</div><div class=card><h2>Moderation Cases</h2>${table(cases,['id','type','target','moderator','reason'])}</div><div class=card><h2>Settings Audit</h2>${table(aud,['id','actor','action','details','at'])}</div>`,gid))});
app.post('/g/:gid/trust',auth,guildRoute,ownerOnly,async(req,res)=>{
 let uid=String(req.body.user||'').trim();
 if(!/^\d{15,22}$/.test(uid))return res.status(400).send('Invalid Discord user ID.');
 let u=await client.users.fetch(uid).catch(()=>null);if(!u||u.bot)return res.status(400).send('Choose a valid human Discord user.');
 db.prepare('INSERT OR REPLACE INTO trust(guild,user) VALUES(?,?)').run(req.params.gid,uid);
 db.prepare('INSERT INTO audit(guild,actor,action,details,at) VALUES(?,?,?,?,?)').run(req.params.gid,req.session.user.id,'security.trust',uid,Date.now());
 res.redirect(`/g/${req.params.gid}/data`);
});
app.post('/g/:gid/untrust',auth,guildRoute,ownerOnly,(req,res)=>{
 let uid=String(req.body.user||'').trim();db.prepare('DELETE FROM trust WHERE guild=? AND user=?').run(req.params.gid,uid);
 db.prepare('INSERT INTO audit(guild,actor,action,details,at) VALUES(?,?,?,?,?)').run(req.params.gid,req.session.user.id,'security.untrust',uid,Date.now());
 res.redirect(`/g/${req.params.gid}/data`);
});
app.post('/g/:gid/custom-command',auth,guildRoute,(req,res)=>{let n=String(req.body.name).toLowerCase().replace(/[^a-z0-9_-]/g,'');db.prepare('INSERT INTO custom_commands(guild,name,response) VALUES(?,?,?) ON CONFLICT(guild,name) DO UPDATE SET response=excluded.response,enabled=1').run(req.params.gid,n,String(req.body.response));res.redirect(`/g/${req.params.gid}/data`)});
app.post('/g/:gid/autoresponder',auth,guildRoute,(req,res)=>{db.prepare('INSERT INTO autoresponders(guild,trigger,response,match_type) VALUES(?,?,?,?)').run(req.params.gid,String(req.body.trigger),String(req.body.response),req.body.match_type==='exact'?'exact':'contains');res.redirect(`/g/${req.params.gid}/data`)});
app.get('/api/status',(req,res)=>res.json({ok:true,bot:client.user?.tag||null,guilds:client.guilds.cache.size,uptime:process.uptime(),ollama:process.env.OLLAMA_MODEL||'qwen3:0.6b'}));
client.once('clientReady',async()=>{startProtectionStatus(client,getConfig);console.log(`SH Protection V6.2 online: ${client.user.tag} • ${client.guilds.cache.size} guild(s)`);let rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),{body:commands}).catch(e=>console.error('Command registration:',e.message));app.listen(Number(process.env.PORT||3000),()=>console.log(`Dashboard: ${base()}`))});
client.login(process.env.DISCORD_TOKEN);
