require('dotenv').config();
const {Client,GatewayIntentBits} = require('discord.js');
const {handleCreateCohort,handleArchiveCohort,handleAddMember,handleListCohorts} = require('./handlers');

const client = new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});

const map = {
  create_cohort:  handleCreateCohort,
  archive_cohort: handleArchiveCohort,
  add_member:     handleAddMember,
  list_cohorts:   handleListCohorts,
};

client.once('ready',()=>console.log(`✅ ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const h = map[interaction.commandName];
  if (!h) return;
  try { await h(interaction); }
  catch(err) {
    console.error(err);
    const msg = `❌ ${err.message}`;
    if (interaction.deferred||interaction.replied) await interaction.editReply(msg).catch(()=>{});
    else await interaction.reply({content:msg,ephemeral:true}).catch(()=>{});
  }
});

client.login(process.env.DISCORD_TOKEN);
