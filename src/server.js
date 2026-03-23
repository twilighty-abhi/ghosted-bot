require('dotenv').config();
const express = require('express');
const path    = require('path');
const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { parseSheet } = require('./sheets');
const {
  provisionCohort, syncCohort, archiveCohort,
  addMember, removeMember, listCohorts, auditCohort,
  categoryName,
} = require('./provision');

// ── Env validation ────────────────────────────────────────────────────────────
const REQUIRED_ENV = ['DISCORD_TOKEN', 'GUILD_ID'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error(`\n❌ Missing required env vars: ${missingEnv.join(', ')}\nAdd them to your .env file and restart.\n`);
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Discord client ────────────────────────────────────────────────────────────
const discord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
let ready = false;

discord.once('clientReady', async () => {
  ready = true;
  console.log(`✅ Discord: ${discord.user.tag}`);

  // Bot permission check
  const guild = discord.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {
    const me = guild.members.me;
    const needed = ['ManageChannels', 'ManageRoles', 'ViewChannel'];
    const missing = needed.filter(p => !me.permissions.has(PermissionFlagsBits[p]));
    if (missing.length) console.warn(`⚠ Bot missing permissions: ${missing.join(', ')} — provisioning may fail.`);
    else console.log(`✅ Bot permissions: OK`);
  }
});
discord.login(process.env.DISCORD_TOKEN);

// ── Concurrent provision guard ────────────────────────────────────────────────
const activeProvisions = new Set();

// ── SSE helpers ───────────────────────────────────────────────────────────────
function sseStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  return (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
}

function makeEmit(write, extraTypes = {}) {
  return (type, payload) => {
    if (type === 'step')             write('log', { level: 'step', text: payload.message });
    else if (type === 'member_ok')        write('log', { level: 'ok',   text: `  ✓ ${payload.name} → ${payload.team}` });
    else if (type === 'member_fail')      write('log', { level: 'fail', text: `  ✗ ${payload.name} — not in server` });
    else if (type === 'member_skip')      write('log', { level: 'skip', text: `  ⚠ ${payload.name} — skipped (${payload.reason})` });
    else if (type === 'member_sync_skip') write('log', { level: 'ok',   text: `  ✓ ${payload.name} — already set up` });
    else if (type === 'done')        write('log', { level: 'done', text: `✅ Done — ${payload.assigned} assigned, ${payload.skipped.length} skipped` });
    else if (type === 'sync_done')   write('log', { level: 'done', text: `✅ Sync done — ${payload.newlyAssigned} new, ${payload.alreadyDone} already set, ${payload.skipped} skipped, ${payload.notFound} not found` });
    else if (type === 'arch_done')   write('log', { level: 'done', text: `✅ Archived — ${payload.channelCount} channels locked as "${payload.archivedName}"` });
    else if (type === 'error')       write('error', { message: payload.message });
    else if (extraTypes[type])       extraTypes[type](payload);
  };
}

// ── /api/status ───────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => res.json({ ready, tag: discord.user?.tag ?? null }));

// ── /api/preview ──────────────────────────────────────────────────────────────
app.post('/api/preview', async (req, res) => {
  const { sheetUrl, cohortNumber } = req.body;
  if (!sheetUrl) return res.status(400).json({ error: 'sheetUrl required' });
  try {
    const data = await parseSheet(sheetUrl);
    const teamCount   = Object.keys(data.teams).length;
    const memberCount = data.participants.length;
    let cohortExists  = false;
    if (cohortNumber && ready) {
      const guild = discord.guilds.cache.get(process.env.GUILD_ID);
      if (guild) {
        await guild.channels.fetch().catch(() => {});
        const catName = `GHOSTED Cohort-${Number(cohortNumber)}`;
        const { ChannelType } = require('discord.js');
        cohortExists = !!guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === catName);
      }
    }
    res.json({ teamCount, memberCount, teams: data.teams, warnings: data.warnings, cohortExists });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── /api/provision ────────────────────────────────────────────────────────────
app.post('/api/provision', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'Discord not ready.' });
  const cohortNumber = Number(req.body.cohortNumber);
  const { sheetUrl } = req.body;
  if (!cohortNumber || !sheetUrl) return res.status(400).json({ error: 'cohortNumber and sheetUrl required' });

  const guardKey = `${process.env.GUILD_ID}:${cohortNumber}`;
  if (activeProvisions.has(guardKey)) return res.status(409).json({ error: `Cohort ${cohortNumber} is already being provisioned.` });
  activeProvisions.add(guardKey);

  const write = sseStream(res);
  const emit  = makeEmit(write);
  const guild = discord.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) { write('error', { message: 'Guild not found. Check GUILD_ID.' }); activeProvisions.delete(guardKey); return res.end(); }

  let data;
  try { data = await parseSheet(sheetUrl); }
  catch (err) { write('error', { message: err.message }); activeProvisions.delete(guardKey); return res.end(); }

  if (data.warnings.length) data.warnings.forEach(w => write('log', { level: 'warn', text: w }));
  try { await provisionCohort(guild, cohortNumber, data.participants, Object.keys(data.teams), emit); }
  catch (err) { write('error', { message: err.message }); }
  finally { activeProvisions.delete(guardKey); }
  write('all_done', {}); res.end();
});

// ── /api/sync ─────────────────────────────────────────────────────────────────
app.post('/api/sync', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'Discord not ready.' });
  const cohortNumber = Number(req.body.cohortNumber);
  const { sheetUrl } = req.body;
  if (!cohortNumber || !sheetUrl) return res.status(400).json({ error: 'cohortNumber and sheetUrl required' });

  const write = sseStream(res);
  const emit  = makeEmit(write);
  const guild = discord.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) { write('error', { message: 'Guild not found.' }); return res.end(); }

  let data;
  try { data = await parseSheet(sheetUrl); }
  catch (err) { write('error', { message: err.message }); return res.end(); }

  try { await syncCohort(guild, cohortNumber, data.participants, emit); }
  catch (err) { write('error', { message: err.message }); }
  write('all_done', {}); res.end();
});

// ── /api/archive ──────────────────────────────────────────────────────────────
app.post('/api/archive', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'Discord not ready.' });
  const cohortNumber = Number(req.body.cohortNumber);
  if (!cohortNumber) return res.status(400).json({ error: 'cohortNumber required' });

  const write = sseStream(res);
  const emit  = makeEmit(write);
  const guild = discord.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) { write('error', { message: 'Guild not found.' }); return res.end(); }

  try { await archiveCohort(guild, cohortNumber, emit); }
  catch (err) { write('error', { message: err.message }); }
  write('all_done', {}); res.end();
});

// ── /api/add-member ───────────────────────────────────────────────────────────
app.post('/api/add-member', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'Discord not ready.' });
  const { discordId, teamSlug } = req.body;
  const cohortNumber = Number(req.body.cohortNumber);
  if (!cohortNumber || !discordId || !teamSlug) return res.status(400).json({ error: 'cohortNumber, discordId, and teamSlug required' });

  const write = sseStream(res);
  const emit  = makeEmit(write);
  const guild = discord.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) { write('error', { message: 'Guild not found.' }); return res.end(); }

  try {
    const result = await addMember(guild, cohortNumber, teamSlug, discordId, emit);
    write('log', { level: 'done', text: `✅ ${result.status === 'added' ? `${result.name} added to Cohort-${cohortNumber} / ${teamSlug}` : `${result.name} already had all roles`}` });
  } catch (err) { write('error', { message: err.message }); }
  write('all_done', {}); res.end();
});

// ── /api/remove-member ────────────────────────────────────────────────────────
app.post('/api/remove-member', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'Discord not ready.' });
  const { discordId } = req.body;
  const cohortNumber  = Number(req.body.cohortNumber);
  if (!cohortNumber || !discordId) return res.status(400).json({ error: 'cohortNumber and discordId required' });

  const write = sseStream(res);
  const emit  = makeEmit(write);
  const guild = discord.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) { write('error', { message: 'Guild not found.' }); return res.end(); }

  try {
    const result = await removeMember(guild, cohortNumber, discordId, emit);
    write('log', { level: 'done', text: `✅ ${result.status === 'removed' ? `Removed ${result.rolesRemoved} GHOSTED role(s) from ${result.name}` : `${result.name} had no GHOSTED roles`}` });
  } catch (err) { write('error', { message: err.message }); }
  write('all_done', {}); res.end();
});

// ── /api/list-cohorts ─────────────────────────────────────────────────────────
app.get('/api/list-cohorts', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'Discord not ready.' });
  const guild = discord.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return res.status(500).json({ error: 'Guild not found.' });
  try { res.json(await listCohorts(guild)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── /api/audit ────────────────────────────────────────────────────────────────
app.get('/api/audit/:cohortNumber', async (req, res) => {
  if (!ready) return res.status(503).json({ error: 'Discord not ready.' });
  const cohortNumber = Number(req.params.cohortNumber);
  if (!cohortNumber) return res.status(400).json({ error: 'Invalid cohort number' });
  const guild = discord.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return res.status(500).json({ error: 'Guild not found.' });
  try { res.json(await auditCohort(guild, cohortNumber)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.GUI_PORT || 3000;
app.listen(PORT, () => console.log(`\n🌐  http://localhost:${PORT}\n`));
