const { ChannelType } = require('discord.js');
const { categoryName, roleTeam } = require('./provision');

async function broadcastAnnouncement(guild, cohortNumber, messageText) {
  const catName = categoryName(cohortNumber);
  const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && (c.name === catName || c.name === `archived-ghosted-cohort-${cohortNumber}`));
  if (!category) throw new Error(`Category for Cohort-${cohortNumber} not found.`);

  const announcementsChannel = guild.channels.cache.find(c => c.parentId === category.id && c.name === 'ghosted-announcements');
  if (!announcementsChannel) throw new Error(`#ghosted-announcements channel not found in Cohort-${cohortNumber}.`);

  await announcementsChannel.send(messageText);
  return { channelName: announcementsChannel.name };
}

async function sendTeamDM(guild, cohortNumber, teamSlug, messageText) {
  await guild.members.fetch();
  const cR = guild.roles.cache.find(r => r.name === `Ghosted-cohort-${cohortNumber}`);
  const tR = guild.roles.cache.find(r => r.name === roleTeam(teamSlug));

  if (!cR) throw new Error(`Cohort role not found.`);
  if (!tR) throw new Error(`Team role not found.`);

  const members = guild.members.cache.filter(m => m.roles.cache.has(cR.id) && m.roles.cache.has(tR.id) && !m.user.bot);
  
  if (members.size === 0) throw new Error(`No members found in Cohort-${cohortNumber} / ${teamSlug}.`);

  let sent = 0;
  let failed = 0;

  for (const [, member] of members) {
    try {
      await member.send(`**Message to Team ${teamSlug} (Cohort-${cohortNumber}):**\n\n${messageText}`);
      sent++;
    } catch (e) {
      failed++;
    }
  }

  return { sent, failed, total: members.size };
}

async function postWelcomeMessage(guild, cohortNumber, categoryId) {
  const welcomeText = process.env.WELCOME_MESSAGE;
  if (!welcomeText) return;

  const generalChannel = guild.channels.cache.find(c => c.parentId === categoryId && c.name === 'ghosted-general');
  if (generalChannel) {
    try {
      await generalChannel.send(welcomeText);
    } catch (e) {
      console.warn(`Failed to post welcome message to ${generalChannel.name}`);
    }
  }
}

module.exports = {
  broadcastAnnouncement,
  sendTeamDM,
  postWelcomeMessage,
};
