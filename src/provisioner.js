/**
 * provisioner.js
 *
 * Handles all Discord operations for GHOSTED cohort management.
 *
 * Naming conventions:
 *   Category : "GHOSTED Cohort-2"
 *   Channels : ghosted-announcements, ghosted-general, ghosted-team-<name>
 *   Roles    : Ghosted-general, Ghosted-cohort-2, Ghosted-<teamname>
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { parseSheet, slug } = require('./sheets');

// ─────────────────────────────────────────────────────────────────────────────
// Naming helpers
// ─────────────────────────────────────────────────────────────────────────────

const categoryName  = n => `GHOSTED Cohort-${n}`;
const roleCohort    = n => `Ghosted-cohort-${n}`;
const roleTeam      = t => `Ghosted-${t}`;
const ROLE_GENERAL  = 'Ghosted-general';
const CH_ANNOUNCE   = 'ghosted-announcements';
const CH_GENERAL    = 'ghosted-general';
const chTeam        = t => `ghosted-team-${t}`;

// ─────────────────────────────────────────────────────────────────────────────
// Discord helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getOrCreateRole(guild, name, color) {
  return guild.roles.cache.find(r => r.name === name)
    ?? await guild.roles.create({ name, color, reason: 'GHOSTED bot' });
}

function organizerOverwrite(guild) {
  const org = guild.roles.cache.find(r => r.name === 'Organizer');
  if (!org) return null;
  return { id: org.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: provision a full cohort
// Calls emit(type, payload) for live progress streaming.
// ─────────────────────────────────────────────────────────────────────────────

async function provisionCohort(guild, cohortNumber, sheetUrl, emit) {
  emit('log', { level: 'section', text: `▶ Provisioning GHOSTED Cohort-${cohortNumber}` });

  // ── 1. Parse sheet ──────────────────────────────────────────────────────
  emit('log', { level: 'step', text: 'Fetching participant data from Google Sheet…' });
  const { teams, warnings, participants } = await parseSheet(sheetUrl);
  const teamNames = Object.keys(teams);

  if (!teamNames.length) throw new Error('No teams found in sheet. Check column headers (Team, Name, Discord ID).');

  warnings.forEach(w => emit('log', { level: 'warn', text: w }));
  emit('log', { level: 'ok', text: `Found ${teamNames.length} teams, ${participants.length} members` });

  // ── 2. Create category ─────────────────────────────────────────────────
  const catName = categoryName(cohortNumber);
  emit('log', { level: 'step', text: `Creating category "${catName}"` });
  const category = await guild.channels.create({
    name: catName,
    type: ChannelType.GuildCategory,
    reason: `GHOSTED bot: cohort ${cohortNumber}`,
  });

  // Move under active programs parent if set
  const parentId = process.env.ACTIVE_CATEGORY_ID;
  if (parentId) {
    const parent = await guild.channels.fetch(parentId).catch(() => null);
    if (parent) await category.setParent(parent.id, { lockPermissions: false });
  }

  // ── 3. Create roles ────────────────────────────────────────────────────
  emit('log', { level: 'step', text: `Creating roles…` });

  const generalRole = await getOrCreateRole(guild, ROLE_GENERAL,        0x5865f2); // blurple
  const cohortRole  = await getOrCreateRole(guild, roleCohort(cohortNumber), 0x57f287); // green
  emit('log', { level: 'ok', text: `Roles: @${ROLE_GENERAL}, @${roleCohort(cohortNumber)}` });

  const teamRoles = {};
  for (const teamName of teamNames) {
    const role = await getOrCreateRole(guild, roleTeam(teamName), 0xfee75c); // yellow
    teamRoles[teamName] = role;
    emit('log', { level: 'ok', text: `  Role: @${roleTeam(teamName)}` });
  }

  // ── 4. Create ghosted-announcements ───────────────────────────────────
  emit('log', { level: 'step', text: `Creating #${CH_ANNOUNCE}` });
  const orgOverwrite = organizerOverwrite(guild);
  await guild.channels.create({
    name: CH_ANNOUNCE,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny:  [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: cohortRole.id,        allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
      ...(orgOverwrite ? [orgOverwrite] : []),
    ],
    reason: `GHOSTED bot: cohort ${cohortNumber}`,
  });

  // ── 5. Create ghosted-general ──────────────────────────────────────────
  emit('log', { level: 'step', text: `Creating #${CH_GENERAL}` });
  await guild.channels.create({
    name: CH_GENERAL,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny:  [PermissionFlagsBits.ViewChannel] },
      { id: cohortRole.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ],
    reason: `GHOSTED bot: cohort ${cohortNumber}`,
  });

  // ── 6. Create team channels ────────────────────────────────────────────
  for (const teamName of teamNames) {
    const chName = chTeam(teamName);
    emit('log', { level: 'step', text: `Creating #${chName}` });
    await guild.channels.create({
      name: chName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone,      deny:  [PermissionFlagsBits.ViewChannel] },
        { id: cohortRole.id,             deny:  [PermissionFlagsBits.ViewChannel] },
        { id: teamRoles[teamName].id,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ],
      reason: `GHOSTED bot: team ${teamName}`,
    });
  }

  // ── 7. Assign roles to members ─────────────────────────────────────────
  emit('log', { level: 'step', text: 'Assigning roles to members…' });
  await guild.members.fetch(); // populate cache

  const assigned = [], skipped = [], notFound = [];

  for (const [teamName, members] of Object.entries(teams)) {
    for (const m of members) {
      if (!m.discordId) {
        skipped.push(m.name);
        emit('log', { level: 'skip', text: `  ⚠ ${m.name} — skipped (no Discord ID)` });
        continue;
      }
      try {
        const member = await guild.members.fetch(m.discordId);
        await member.roles.add(
          [generalRole, cohortRole, teamRoles[teamName]],
          'GHOSTED bot: cohort provisioning'
        );
        assigned.push(m.name);
        emit('log', { level: 'ok', text: `  ✓ ${m.name} → @${roleTeam(teamName)}` });
      } catch {
        notFound.push(m.name);
        emit('log', { level: 'fail', text: `  ✗ ${m.name} (${m.discordId}) — not in server` });
      }
    }
  }

  emit('log', { level: 'done', text: `✅ Cohort-${cohortNumber} done — ${assigned.length} assigned, ${skipped.length} skipped, ${notFound.length} not found` });

  return { assigned, skipped, notFound, teamNames };
}

// ─────────────────────────────────────────────────────────────────────────────
// Archive a cohort
// ─────────────────────────────────────────────────────────────────────────────

async function archiveCohort(guild, cohortNumber) {
  const catName = categoryName(cohortNumber);

  const category = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === catName
  );
  if (!category) throw new Error(`Category "${catName}" not found.`);

  // Rename
  await category.setName(`archived-ghosted-cohort-${cohortNumber}`, 'GHOSTED bot: archiving');

  // Lock all channels — everyone can read, nobody can write
  const children = guild.channels.cache.filter(c => c.parentId === category.id);
  for (const [, ch] of children) {
    await ch.permissionOverwrites.set([
      { id: guild.roles.everyone, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
    ]);
  }

  return { archivedName: `archived-ghosted-cohort-${cohortNumber}`, channelCount: children.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// Add a single member to an existing cohort
// ─────────────────────────────────────────────────────────────────────────────

async function addMember(guild, cohortNumber, teamName, discordUser) {
  const teamSlug = slug(teamName);

  const generalRole = guild.roles.cache.find(r => r.name === ROLE_GENERAL);
  const cohortRole  = guild.roles.cache.find(r => r.name === roleCohort(cohortNumber));
  const tRole       = guild.roles.cache.find(r => r.name === roleTeam(teamSlug));

  if (!cohortRole) throw new Error(`Role "${roleCohort(cohortNumber)}" not found. Has this cohort been created?`);
  if (!tRole)      throw new Error(`Role "${roleTeam(teamSlug)}" not found. Does team "${teamName}" exist?`);

  const member = await guild.members.fetch(discordUser.id);
  const rolesToAdd = [cohortRole, tRole];
  if (generalRole) rolesToAdd.push(generalRole);
  await member.roles.add(rolesToAdd, 'GHOSTED bot: add_member');

  return { roleCohort: roleCohort(cohortNumber), roleTeam: roleTeam(teamSlug) };
}

module.exports = { provisionCohort, archiveCohort, addMember, categoryName, roleCohort, chTeam };
