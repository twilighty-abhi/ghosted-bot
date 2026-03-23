require('dotenv').config();
const {REST,Routes}=require('discord.js');
const commands=require('./commands');
const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
(async()=>{
  try{
    console.log(`Deploying ${commands.length} commands…`);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:commands.map(c=>c.toJSON())});
    console.log('✅ Done.');
  }catch(err){console.error('❌',err);}
})();
