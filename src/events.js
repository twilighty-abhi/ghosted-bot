const { EmbedBuilder } = require('discord.js');
const { getDb } = require('./db');
const { parseSheet } = require('./sheets');
const { roleCohort, roleTeam } = require('./provision');

// Cache sheets in memory for 15 minutes to avoid Google rate limits on join bursts
const sheetCache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

async function getCachedSheet(url) {
  const cached = sheetCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
  const data = await parseSheet(url);
  sheetCache.set(url, { timestamp: Date.now(), data });
  return data;
}

function setupAutoRole(discord) {
  discord.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    
    const db = getDb();
    const activeCohorts = db.prepare('SELECT cohort_number, sheet_url FROM cohorts WHERE guild_id = ? AND status = ?').all(member.guild.id, 'active');
    
    if (activeCohorts.length === 0) return;

    for (const cohort of activeCohorts) {
      if (!cohort.sheet_url) continue;
      
      try {
        const data = await getCachedSheet(cohort.sheet_url);
        const participant = data.participants.find(p => p.discordId === member.id);
        
        if (participant) {
          const gR = member.guild.roles.cache.find(r => r.name === 'Ghosted-general');
          const cR = member.guild.roles.cache.find(r => r.name === roleCohort(cohort.cohort_number));
          const tR = member.guild.roles.cache.find(r => r.name === roleTeam(participant.team));
          
          const rolesToAdd = [gR, cR, tR].filter(Boolean);
          if (rolesToAdd.length > 0) {
            await member.roles.add(rolesToAdd, `Auto-role on join (matched sheet for Cohort-${cohort.cohort_number})`);
            console.log(`[AutoRole] Assigned roles to ${member.user.tag} for Cohort-${cohort.cohort_number}`);
          }
          break; // Found them, no need to check other cohorts
        }
      } catch (e) {
        console.error(`[AutoRole] Failed parsing sheet for Cohort-${cohort.cohort_number}:`, e);
      }
    }
  });
}

function setupLeaveDetection(discord) {
  discord.on('guildMemberRemove', async (member) => {
    // Check if they had any Ghosted role
    const ghostedRoles = member.roles.cache.filter(r => r.name.startsWith('Ghosted-'));
    if (ghostedRoles.size === 0) return;

    const logChannelId = process.env.BOT_LOG_CHANNEL_ID;
    if (!logChannelId) return;

    const channel = member.guild.channels.cache.get(logChannelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor('#ed4245')
      .setTitle('Member Left Server')
      .setDescription(`**${member.user.tag}** (${member.id}) left the server.`)
      .addFields({ name: 'Roles they had', value: ghostedRoles.map(r => `<@&${r.id}>`).join(' ') || 'None' })
      .setTimestamp();

    try {
      await channel.send({ embeds: [embed] });
    } catch (e) {
      console.error('[LeaveDetection] Failed to send embed to log channel');
    }
  });
}

function setupScheduledArchive(discord) {
  // Run once a day at noon
  setInterval(async () => {
    const db = getDb();
    // Assuming archive_date is stored as YYYY-MM-DD
    const dueForArchive = db.prepare("SELECT cohort_number, guild_id FROM cohorts WHERE status = 'active' AND archived_at IS NOT NULL AND date(archived_at) <= date('now')").all();
    
    if (dueForArchive.length === 0) return;

    const { archiveCohort } = require('./provision'); // lazy load to avoid cycle
    
    for (const cohort of dueForArchive) {
      const guild = discord.guilds.cache.get(cohort.guild_id);
      if (!guild) continue;
      
      try {
        console.log(`[AutoArchive] Auto-archiving Cohort-${cohort.cohort_number} (scheduled)`);
        await archiveCohort(guild, cohort.cohort_number, (_type, _payload) => {}); // silent emit
        
        // Update DB
        db.prepare("UPDATE cohorts SET status = 'archived' WHERE cohort_number = ? AND guild_id = ?").run(cohort.cohort_number, cohort.guild_id);
        
        // Log it if channel exists
        const logChannelId = process.env.BOT_LOG_CHANNEL_ID;
        if (logChannelId) {
          const ch = guild.channels.cache.get(logChannelId);
          if (ch) ch.send(`📦 **Automated System:** Cohort-${cohort.cohort_number} has been archived according to schedule.`);
        }
      } catch (e) {
        console.error(`[AutoArchive] Failed to archive Cohort-${cohort.cohort_number}:`, e);
      }
    }
  }, 24 * 60 * 60 * 1000);
}

module.exports = {
  setupAutoRole,
  setupLeaveDetection,
  setupScheduledArchive
};
