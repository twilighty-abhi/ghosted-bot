const { EmbedBuilder } = require('discord.js');
const { getDb } = require('./db');
const { categoryName } = require('./provision');

function logActivity(action, cohortNumber, username, details = {}) {
  try {
    const db = getDb();
    db.prepare('INSERT INTO activity_log (action, cohort_number, username, details) VALUES (?, ?, ?, ?)')
      .run(action, cohortNumber, username, JSON.stringify(details));
  } catch (e) {
    console.error(`[Logger] Failed to insert activity log for ${action}:`, e);
  }
}

async function sendWebhook(guild, embedOptions) {
  const channelId = process.env.BOT_LOG_CHANNEL_ID;
  if (!channelId) return;

  try {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(embedOptions.color || '#5865f2')
      .setTitle(embedOptions.title)
      .setDescription(embedOptions.description)
      .setTimestamp();
      
    if (embedOptions.fields) {
      embed.addFields(embedOptions.fields);
    }

    await channel.send({ embeds: [embed] });
  } catch (e) {
    console.error(`[Logger] Failed to send webhook to log channel:`, e);
  }
}

function getActivityLogs(limit = 50) {
  try {
    const db = getDb();
    return db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit).map(row => ({
      ...row,
      details: row.details ? JSON.parse(row.details) : {}
    }));
  } catch (e) {
    console.error('[Logger] Failed to fetch activity logs:', e);
    return [];
  }
}

module.exports = {
  logActivity,
  sendWebhook,
  getActivityLogs
};
