const {
  joinVoiceChannel,createAudioPlayer,createAudioResource,
  AudioPlayerStatus,VoiceConnectionStatus,entersState,
  NoSubscriberBehavior,StreamType,generateDependencyReport
}=require('@discordjs/voice');
const play=require('play-dl');
const prism=require('prism-media');
const ffmpegPath=require('ffmpeg-static');
const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags}=require('discord.js');

const players=new Map();

function state(guildId){
  if(!players.has(guildId))players.set(guildId,{
    queue:[],current:null,connection:null,player:null,subscription:null,
    textChannel:null,panelMessage:null,loop:false,volume:80,paused:false,
    skipRequested:false,actuallyPlaying:false,transcoder:null
  });
  return players.get(guildId);
}
function controls(disabled=false){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music_prev').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('music_pause').setEmoji('⏯️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('music_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('music_loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('music_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}
function panelEmbed(s){
  const q=s.queue.slice(0,5).map((x,i)=>`${i+1}. **${x.title}**`).join('\n')||'Queue is empty.';
  let status='⏹️ Idle';
  if(s.current&&!s.actuallyPlaying)status='⏳ Loading audio';
  if(s.actuallyPlaying)status=s.paused?'⏸️ Paused':'▶️ Playing';
  return new EmbedBuilder().setTitle('🎵 SH Music')
    .setDescription(s.current?`**Now Playing**\n[${s.current.title}](${s.current.url})\nRequested by <@${s.current.requester}>`:'Nothing is playing.')
    .addFields({name:'Queue',value:q.slice(0,1024)},{name:'Player',value:`${status} • Loop ${s.loop?'ON':'OFF'} • Volume ${s.volume}%`})
    .setFooter({text:'SH Protection Shield • Music'});
}
async function updatePanel(s){
  if(!s.textChannel)return;
  const payload={embeds:[panelEmbed(s)],components:[controls(!s.current)]};
  if(s.panelMessage){
    const m=await s.textChannel.messages.fetch(s.panelMessage).catch(()=>null);
    if(m){await m.edit(payload).catch(()=>{});return;}
  }
  const m=await s.textChannel.send(payload).catch(()=>null);
  if(m)s.panelMessage=m.id;
}
async function resolveTrack(query,requester){
  if(/^https?:\/\//i.test(query)){
    const info=await play.video_basic_info(query).catch(()=>null);
    if(info?.video_details)return {title:info.video_details.title,url:info.video_details.url,requester};
  }
  const results=await play.search(query,{limit:1,source:{youtube:'video'}});
  if(!results.length)throw new Error('No song found.');
  return {title:results[0].title,url:results[0].url,requester};
}
async function ensureConnection(interaction,s){
  const vc=interaction.member?.voice?.channel;
  if(!vc)throw new Error('Join a voice channel first.');
  const me=interaction.guild.members.me;
  const perms=vc.permissionsFor(me);
  if(!perms?.has('Connect')||!perms?.has('Speak'))throw new Error('I need Connect and Speak permission in that voice channel.');

  if(s.connection&&s.connection.joinConfig.channelId!==vc.id){
    s.connection.destroy();s.connection=null;s.subscription=null;
  }
  if(!s.connection){
    s.connection=joinVoiceChannel({
      channelId:vc.id,guildId:interaction.guildId,
      adapterCreator:interaction.guild.voiceAdapterCreator,
      selfDeaf:true,selfMute:false
    });
    s.connection.on(VoiceConnectionStatus.Disconnected,async()=>{
      try{await Promise.race([
        entersState(s.connection,VoiceConnectionStatus.Signalling,5000),
        entersState(s.connection,VoiceConnectionStatus.Connecting,5000)
      ])}catch{try{s.connection.destroy()}catch{} s.connection=null;s.subscription=null;}
    });
    await entersState(s.connection,VoiceConnectionStatus.Ready,20000);
  }
  if(!s.player){
    s.player=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Play}});
    s.player.on(AudioPlayerStatus.Playing,async()=>{s.actuallyPlaying=true;s.paused=false;await updatePanel(s)});
    s.player.on(AudioPlayerStatus.Paused,async()=>{s.paused=true;await updatePanel(s)});
    s.player.on(AudioPlayerStatus.AutoPaused,()=>{console.warn('[MUSIC] Player auto-paused: no usable subscriber.')});
    s.player.on(AudioPlayerStatus.Idle,async()=>{
      if(!s.current)return;
      if(s.loop&&!s.skipRequested)s.queue.unshift(s.current);
      s.skipRequested=false;s.current=null;s.paused=false;s.actuallyPlaying=false;
      if(s.transcoder){try{s.transcoder.destroy()}catch{} s.transcoder=null}
      await playNext(interaction.guildId).catch(e=>musicError(s,e));
    });
    s.player.on('error',async e=>{
      await musicError(s,e);
      s.current=null;s.actuallyPlaying=false;
      await playNext(interaction.guildId).catch(err=>musicError(s,err));
    });
  }
  s.subscription=s.connection.subscribe(s.player);
  if(!s.subscription)throw new Error('Discord voice connection could not subscribe to the audio player.');
}
async function musicError(s,e){
  console.error('[MUSIC ERROR]',e?.stack||e);
  s.actuallyPlaying=false;
  if(s.textChannel)await s.textChannel.send(`⚠️ Music playback error: ${String(e?.message||e).slice(0,300)}`).catch(()=>{});
  await updatePanel(s);
}
async function makeAudioResource(url,s){
  const source=await play.stream(url,{discordPlayerCompatibility:true});
  source.stream.on('error',e=>console.error('[MUSIC SOURCE]',e.message));

  // Always run the resolved media through bundled FFmpeg. This avoids silent
  // playback when YouTube returns a container/codec combination Discord cannot
  // consume directly on a particular Windows machine.
  const ffmpeg=new prism.FFmpeg({
    executable:ffmpegPath,
    args:[
      '-hide_banner','-loglevel','warning',
      '-analyzeduration','0','-probesize','32',
      '-i','pipe:0','-f','s16le','-ar','48000','-ac','2','pipe:1'
    ]
  });
  s.transcoder=ffmpeg;
  ffmpeg.on('error',e=>console.error('[MUSIC FFMPEG]',e.message));
  source.stream.pipe(ffmpeg);

  const resource=createAudioResource(ffmpeg,{inputType:StreamType.Raw,inlineVolume:true});
  resource.volume.setVolume(Math.max(0,Math.min(1.5,s.volume/100)));
  return resource;
}
async function playNext(guildId){
  const s=state(guildId);
  if(s.current||!s.queue.length){await updatePanel(s);return;}
  if(!s.player||!s.connection)throw new Error('Voice player is not connected.');
  s.current=s.queue.shift();s.actuallyPlaying=false;s.paused=false;
  await updatePanel(s);
  const resource=await makeAudioResource(s.current.url,s);
  s.player.play(resource);
  await entersState(s.player,AudioPlayerStatus.Playing,20000);
}
async function playCommand(interaction,query){
  const s=state(interaction.guildId);
  await ensureConnection(interaction,s);
  s.textChannel=interaction.channel;
  const track=await resolveTrack(query,interaction.user.id);
  s.queue.push(track);
  await interaction.editReply(`🎵 Added **${track.title}** to the queue.`);
  await playNext(interaction.guildId);
}
async function stop(guildId){
  const s=state(guildId);
  s.queue=[];s.current=null;s.loop=false;s.paused=false;s.actuallyPlaying=false;
  if(s.transcoder){try{s.transcoder.destroy()}catch{} s.transcoder=null}
  s.player?.stop(true);s.subscription?.unsubscribe();
  s.connection?.destroy();s.connection=null;s.player=null;s.subscription=null;
  await updatePanel(s);
}
function sameVoice(interaction,s){
  return interaction.member?.voice?.channelId&&s.connection?.joinConfig?.channelId===interaction.member.voice.channelId;
}
async function handleButton(interaction){
  if(!interaction.customId.startsWith('music_'))return false;
  const s=state(interaction.guildId);
  if(!sameVoice(interaction,s)){
    await interaction.reply({content:'❌ Join my voice channel to control music.',flags:MessageFlags.Ephemeral});
    return true;
  }
  if(interaction.customId==='music_pause'){
    if(s.paused){s.player?.unpause();s.paused=false}else{s.player?.pause();s.paused=true}
  }else if(interaction.customId==='music_skip'){
    s.skipRequested=true;s.player?.stop();
  }else if(interaction.customId==='music_loop'){
    s.loop=!s.loop;
  }else if(interaction.customId==='music_stop'){
    await stop(interaction.guildId);
  }
  await interaction.deferUpdate().catch(()=>{});
  await updatePanel(s);
  return true;
}
function queueText(guildId){
  const s=state(guildId),rows=[];
  if(s.current)rows.push(`▶️ **${s.current.title}**`);
  rows.push(...s.queue.slice(0,10).map((x,i)=>`${i+1}. ${x.title}`));
  return rows.join('\n')||'The music queue is empty.';
}
function setVolume(guildId,value){
  const s=state(guildId);s.volume=Math.max(0,Math.min(150,value));
  const r=s.player?.state?.resource;if(r?.volume)r.volume.setVolume(s.volume/100);
  updatePanel(s).catch(()=>{});return s.volume;
}
function dependencyReport(){return generateDependencyReport()}
module.exports={playCommand,handleButton,stop,queueText,setVolume,state,dependencyReport};
