const {ChannelType,PermissionFlagsBits} = require('discord.js');
const {parseSheet,slug} = require('./sheets');
const {provisionCohort,categoryName,roleCohort,roleTeam} = require('./provision');

const ALLOWED = ['Admin','Organizer'];
const ok = m => m.roles.cache.some(r=>ALLOWED.includes(r.name));

async function handleCreateCohort(interaction) {
  if (!ok(interaction.member)) return interaction.reply({content:'🚫 Organizer/Admin only.',ephemeral:true});
  await interaction.deferReply({ephemeral:true});
  const n = interaction.options.getInteger('cohort_number');
  const url = interaction.options.getString('sheet_url');
  let participants,teams,warnings;
  try { ({participants,teams,warnings}=await parseSheet(url)); }
  catch(err) { return interaction.editReply(`❌ Sheet error: ${err.message}`); }
  if (!participants.length) return interaction.editReply('❌ No participants found.');
  await interaction.editReply(`⏳ Provisioning **${categoryName(n)}** — ${teams.length} teams, ${participants.length} members…`);
  const log=[];
  const emit=(type,p)=>{
    if(type==='step')        log.push(`› ${p.message}`);
    if(type==='member_ok')   log.push(`✓ ${p.name} → Ghosted-${p.team}`);
    if(type==='member_fail') log.push(`✗ ${p.name} — not found`);
    if(type==='member_skip') log.push(`⚠ ${p.name} — ${p.reason}`);
  };
  try {
    const {assigned,skipped} = await provisionCohort(interaction.guild,n,participants,teams,emit);
    await interaction.editReply([
      `✅ **${categoryName(n)} created!**`,
      `Teams: ${teams.map(t=>`\`ghosted-team-${t}\``).join(', ')}`,
      `Assigned: ${assigned.length} members`,
      skipped.length?`⚠ Skipped: ${skipped.map(s=>s.name).join(', ')}`:null,
      warnings.length?`\nSheet warnings:\n${warnings.map(w=>`• ${w}`).join('\n')}`:null,
    ].filter(Boolean).join('\n'));
  } catch(err) { await interaction.editReply(`❌ ${err.message}`); }
}

async function handleArchiveCohort(interaction) {
  if (!ok(interaction.member)) return interaction.reply({content:'🚫 Organizer/Admin only.',ephemeral:true});
  await interaction.deferReply({ephemeral:true});
  const n=interaction.options.getInteger('cohort_number');
  const guild=interaction.guild;
  const catName=categoryName(n);
  const archivedName=`archived-ghosted-cohort-${n}`;
  const category=guild.channels.cache.find(c=>c.type===ChannelType.GuildCategory&&c.name===catName);
  if (!category) return interaction.editReply(`❌ **${catName}** not found.`);
  await category.setName(archivedName,'Ghosted bot: archiving');
  const archId=process.env.ARCHIVE_CATEGORY_ID;
  if (archId) {
    const p=await guild.channels.fetch(archId).catch(()=>null);
    if(p) await category.setParent(p.id,{lockPermissions:false});
  }
  const children=guild.channels.cache.filter(c=>c.parentId===category.id);
  for(const[,ch] of children){
    await ch.permissionOverwrites.edit(guild.roles.everyone,{ViewChannel:true,SendMessages:false});
    for(const[,ow] of ch.permissionOverwrites.cache)
      if(ow.id!==guild.roles.everyone.id) await ch.permissionOverwrites.edit(ow.id,{SendMessages:false});
  }
  await interaction.editReply(`📦 **${catName}** archived. All channels are read-only.`);
}

async function handleAddMember(interaction) {
  if (!ok(interaction.member)) return interaction.reply({content:'🚫 Organizer/Admin only.',ephemeral:true});
  await interaction.deferReply({ephemeral:true});
  const n=interaction.options.getInteger('cohort_number');
  const team=slug(interaction.options.getString('team'));
  const targetUser=interaction.options.getUser('user');
  const guild=interaction.guild;
  const gR=guild.roles.cache.find(r=>r.name==='Ghosted-general');
  const cR=guild.roles.cache.find(r=>r.name===roleCohort(n));
  const tR=guild.roles.cache.find(r=>r.name===roleTeam(team));
  if(!gR) return interaction.editReply('❌ Role `Ghosted-general` not found.');
  if(!cR) return interaction.editReply(`❌ Role \`${roleCohort(n)}\` not found.`);
  if(!tR) return interaction.editReply(`❌ Role \`${roleTeam(team)}\` not found.`);
  let member;
  try{member=await guild.members.fetch(targetUser.id);}
  catch{return interaction.editReply(`❌ ${targetUser.tag} is not in this server.`);}
  await member.roles.add([gR,cR,tR],`Added by ${interaction.user.tag}`);
  await interaction.editReply(`✅ **${targetUser.tag}** added to cohort ${n}, team \`${team}\`.`);
}

async function handleListCohorts(interaction) {
  if (!ok(interaction.member)) return interaction.reply({content:'🚫 Organizer/Admin only.',ephemeral:true});
  await interaction.deferReply({ephemeral:true});
  const guild=interaction.guild;
  const cohorts=guild.channels.cache.filter(
    c=>c.type===ChannelType.GuildCategory&&c.name.startsWith('GHOSTED Cohort-')&&!c.name.startsWith('archived-')
  );
  if(!cohorts.size) return interaction.editReply('📭 No active cohorts found.');
  const lines=['📋 **Active GHOSTED Cohorts**\n'];
  for(const[,cat] of cohorts.sort((a,b)=>a.name.localeCompare(b.name))){
    const teams=guild.channels.cache.filter(c=>c.parentId===cat.id&&c.name.startsWith('ghosted-team-'));
    lines.push(`**${cat.name}** — ${teams.map(c=>`\`${c.name}\``).join(', ')||'no teams'}`);
  }
  await interaction.editReply(lines.join('\n'));
}

module.exports = {handleCreateCohort,handleArchiveCohort,handleAddMember,handleListCohorts};
