const {ActivityType}=require('discord.js');

function totals(client){
  const guilds=client.guilds.cache.size;
  const members=client.guilds.cache.reduce((n,g)=>n+(g.memberCount||0),0);
  return {guilds,members};
}
function startProtectionStatus(client,getConfig){
  let index=0;
  const update=()=>{
    if(!client.user)return;
    const {guilds,members}=totals(client);
    const protectedGuilds=[...client.guilds.cache.values()].filter(g=>{
      try{return getConfig(g.id).security.enabled}catch{return false}
    }).length;
    const statuses=[
      `🛡️ Protecting ${protectedGuilds} Servers`,
      `👥 Protecting ${members.toLocaleString()} Members`,
      `⚡ SH Protection Shield`
    ];
    client.user.setPresence({
      activities:[{name:statuses[index++%statuses.length],type:ActivityType.Watching}],
      status:'online'
    });
  };
  update();
  let seconds=20;try{const first=client.guilds.cache.first();if(first)seconds=Math.max(15,Number(getConfig(first.id).status?.rotateSeconds||20))}catch{}
  return setInterval(update,seconds*1000);
}
module.exports={startProtectionStatus,totals};
