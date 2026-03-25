const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { slug } = require('./sheets');
const { postWelcomeMessage } = require('./comms');

const ROLE_GENERAL = 'Ghosted-general';
const roleCohort   = n => `Ghosted-cohort-${n}`;
const roleTeam     = t => `Ghosted-${t}`;
const categoryName = n => `GHOSTED Cohort-${n}`;

const sleep = ms => new Promise(res => setTimeout(res, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getOrCreateRole(guild, name, color, hoist = false) {
  return guild.roles.cache.find(r => r.name === name)
    ?? await guild.roles.create({ name, color, hoist, reason: 'Ghosted bot' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Provision: full cohort setup
// ─────────────────────────────────────────────────────────────────────────────

async function provisionCohort(guild, cohortNum, participants, teams, emit, welcomeMessage) {
  emit('step', { message: 'Fetching server member list…' });
  await guild.members.fetch();

  // Guard — abort if cohort already exists
  const existing = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === categoryName(cohortNum)
  );
  if (existing) throw new Error(
    `Cohort ${cohortNum} already exists (category "${categoryName(cohortNum)}" found). Delete it first or choose a different cohort number.`
  );

  // 1. Category
  emit('step', { message: `Creating category: ${categoryName(cohortNum)}` });
  const category = await guild.channels.create({
    name: categoryName(cohortNum),
    type: ChannelType.GuildCategory,
    reason: `Ghosted bot: cohort ${cohortNum}`,
  });

  async function rollback(err) {
    emit('step', { message: '⚠ Error — rolling back…' });
    try {
      const children = guild.channels.cache.filter(c => c.parentId === category.id);
      for (const [, ch] of children) await ch.delete('GHOSTED bot rollback').catch(() => {});
      await category.delete('GHOSTED bot rollback').catch(() => {});
    } catch { /* best-effort */ }
    throw err;
  }

  try {
    const activeCatId = process.env.ACTIVE_CATEGORY_ID;
    if (activeCatId) {
      const parent = await guild.channels.fetch(activeCatId).catch(() => null);
      if (parent) await category.setParent(parent.id, { lockPermissions: false });
    }

    // 2. Roles
    emit('step', { message: `Creating role: ${ROLE_GENERAL}` });
    const generalRole = await getOrCreateRole(guild, ROLE_GENERAL, 0x5865f2, false);

    emit('step', { message: `Creating role: ${roleCohort(cohortNum)}` });
    const cohortRole = await getOrCreateRole(guild, roleCohort(cohortNum), 0x57f287);

    const teamRoles = {};
    for (const team of Object.keys(teams)) {
      emit('step', { message: `Creating role: ${roleTeam(team)}` });
      teamRoles[team] = await getOrCreateRole(guild, roleTeam(team), 0xfee75c);
    }

    const orgRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'ghosted-organizers');
    const orgOverwrite = orgRole ? [{ id: orgRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : [];
    const botOverwrite = [{ id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }];

    // 3. #ghosted-announcements
    emit('step', { message: 'Creating #ghosted-announcements' });
    await guild.channels.create({
      name: 'ghosted-announcements', type: ChannelType.GuildText, parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: cohortRole.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
        ...botOverwrite,
        ...orgOverwrite,
      ],
    });

    // 4. #ghosted-general
    emit('step', { message: 'Creating #ghosted-general' });
    await guild.channels.create({
      name: 'ghosted-general', type: ChannelType.GuildText, parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: cohortRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ...botOverwrite,
        ...orgOverwrite,
      ],
    });

    // 5. Team channels
    for (const team of Object.keys(teams)) {
      emit('step', { message: `Creating #ghosted-team-${team}` });
      await guild.channels.create({
        name: `ghosted-team-${team}`, type: ChannelType.GuildText, parent: category.id,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: cohortRole.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: teamRoles[team].id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          ...botOverwrite,
          ...orgOverwrite,
        ],
      });
    }

    // 6. Assign roles (with rate-limit sleep)
    emit('step', { message: 'Assigning roles to members…' });
    const assigned = [], skipped = [];
    for (const p of participants) {
      if (!p.discordId) {
        skipped.push({ name: p.name, reason: 'no Discord ID' });
        emit('member_skip', { name: p.name, team: p.team, reason: 'no Discord ID' });
        continue;
      }
      try {
        const member = await guild.members.fetch(p.discordId);
        await member.roles.add(
          [generalRole, cohortRole, teamRoles[p.team]].filter(Boolean),
          `Ghosted bot cohort ${cohortNum}`
        );
        assigned.push(p.name);
        emit('member_ok', { name: p.name, team: p.team });
      } catch {
        skipped.push({ name: p.name, reason: 'not found in server' });
        emit('member_fail', { name: p.name, team: p.team });
      }
      await sleep(300); // respect rate limits
    }

    emit('done', { categoryName: categoryName(cohortNum), teams, assigned: assigned, skipped: skipped });
  
    // Post welcome message if configured
    await postWelcomeMessage(guild, cohortNum, category.id, welcomeMessage);
  
    return { assigned, skipped };
  } catch (err) { await rollback(err); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync: assign roles to new members only
// ─────────────────────────────────────────────────────────────────────────────

async function syncCohort(guild, cohortNum, participants, emit) {
  emit('step', { message: `Syncing GHOSTED Cohort-${cohortNum}…` });
  await guild.members.fetch();

  const cohortRole = guild.roles.cache.find(r => r.name === roleCohort(cohortNum));
  if (!cohortRole) throw new Error(`Role "${roleCohort(cohortNum)}" not found. Has Cohort-${cohortNum} been provisioned?`);

  const generalRole = guild.roles.cache.find(r => r.name === ROLE_GENERAL);
  const newlyAssigned = [], alreadyDone = [], skipped = [], notFound = [];

  for (const p of participants) {
    if (!p.discordId) {
      skipped.push(p.name);
      emit('member_skip', { name: p.name, team: p.team, reason: 'no Discord ID' });
      continue;
    }
    let member;
    try { member = await guild.members.fetch(p.discordId); }
    catch { notFound.push(p.name); emit('member_fail', { name: p.name, team: p.team }); continue; }

    const teamRole = guild.roles.cache.find(r => r.name === roleTeam(p.team));
    if (!teamRole) {
      skipped.push(p.name);
      emit('member_skip', { name: p.name, team: p.team, reason: `role @${roleTeam(p.team)} not found` });
      continue;
    }

    if (member.roles.cache.has(cohortRole.id) && member.roles.cache.has(teamRole.id)) {
      alreadyDone.push(p.name);
      emit('member_sync_skip', { name: p.name, team: p.team });
      continue;
    }

    const toAdd = [cohortRole, teamRole, ...(generalRole ? [generalRole] : [])].filter(r => !member.roles.cache.has(r.id));
    await member.roles.add(toAdd, `GHOSTED bot sync cohort ${cohortNum}`);
    newlyAssigned.push(p.name);
    emit('member_ok', { name: p.name, team: p.team });
    await sleep(300);
  }

  emit('sync_done', {
    cohortNum,
    newlyAssigned: newlyAssigned.length,
    alreadyDone: alreadyDone.length,
    skipped: skipped.length,
    notFound: notFound.length,
  });
  return { newlyAssigned, alreadyDone, skipped, notFound };
}

// ─────────────────────────────────────────────────────────────────────────────
// Archive: rename + lock all channels in a cohort
// ─────────────────────────────────────────────────────────────────────────────

async function archiveCohort(guild, cohortNum, emit) {
  emit('step', { message: 'Fetching channels…' });
  await guild.channels.fetch();

  const category = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === categoryName(cohortNum)
  );
  if (!category) throw new Error(`Category "${categoryName(cohortNum)}" not found. Is Cohort-${cohortNum} provisioned?`);

  const archivedName = `archived-ghosted-cohort-${cohortNum}`;
  emit('step', { message: `Renaming to "${archivedName}"…` });
  await category.setName(archivedName, 'GHOSTED bot: archiving');

  const children = guild.channels.cache.filter(c => c.parentId === category.id);
  for (const [, ch] of children) {
    emit('step', { message: `Locking #${ch.name}…` });
    await ch.permissionOverwrites.set([
      { id: guild.roles.everyone, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
    ], 'GHOSTED bot: archive lock');
    await sleep(500);
  }

  emit('arch_done', { archivedName, channelCount: children.size });
  return { archivedName, channelCount: children.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Member: add a single latejoiner to an existing cohort
// ─────────────────────────────────────────────────────────────────────────────

async function addMember(guild, cohortNum, teamSlug, discordId, emit) {
  emit('step', { message: `Looking up member ${discordId}…` });

  const cohortRole = guild.roles.cache.find(r => r.name === roleCohort(cohortNum));
  if (!cohortRole) throw new Error(`Role "${roleCohort(cohortNum)}" not found. Has Cohort-${cohortNum} been provisioned?`);

  const teamRole = guild.roles.cache.find(r => r.name === roleTeam(teamSlug));
  if (!teamRole) throw new Error(`Role "${roleTeam(teamSlug)}" not found. Does team "${teamSlug}" exist in Cohort-${cohortNum}?`);

  const generalRole = guild.roles.cache.find(r => r.name === ROLE_GENERAL);

  let member;
  try { member = await guild.members.fetch(discordId); }
  catch { throw new Error(`Discord ID ${discordId} not found in server.`); }

  const toAdd = [cohortRole, teamRole, ...(generalRole ? [generalRole] : [])].filter(r => !member.roles.cache.has(r.id));

  if (toAdd.length === 0) {
    emit('member_sync_skip', { name: member.displayName, team: teamSlug });
    return { status: 'already_done', name: member.displayName };
  }

  await member.roles.add(toAdd, `GHOSTED bot: add to cohort ${cohortNum}`);
  emit('member_ok', { name: member.displayName, team: teamSlug });
  return { status: 'added', name: member.displayName };
}

// ─────────────────────────────────────────────────────────────────────────────
// Remove Member: strip all GHOSTED roles from a member
// ─────────────────────────────────────────────────────────────────────────────

async function removeMember(guild, cohortNum, discordId, emit) {
  emit('step', { message: `Looking up member ${discordId}…` });

  let member;
  try { member = await guild.members.fetch(discordId); }
  catch { throw new Error(`Discord ID ${discordId} not found in server.`); }

  // Strip cohort-specific roles (general + cohort + all team roles)
  const ghostedRoles = member.roles.cache.filter(r =>
    r.name === ROLE_GENERAL ||
    r.name === roleCohort(cohortNum) ||
    (r.name.startsWith('Ghosted-') && r.name !== ROLE_GENERAL)
  );

  if (ghostedRoles.size === 0) {
    emit('step', { message: `${member.displayName} has no GHOSTED roles for Cohort-${cohortNum}.` });
    return { status: 'no_roles', name: member.displayName };
  }

  emit('step', { message: `Removing ${ghostedRoles.size} GHOSTED role(s) from ${member.displayName}…` });
  await member.roles.remove([...ghostedRoles.values()], `GHOSTED bot: remove from cohort ${cohortNum}`);
  emit('member_ok', { name: member.displayName, team: 'removed' });
  return { status: 'removed', name: member.displayName, rolesRemoved: ghostedRoles.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// List Cohorts: return all GHOSTED categories
// ─────────────────────────────────────────────────────────────────────────────

async function listCohorts(guild) {
  await guild.channels.fetch();
  await guild.members.fetch();
  return [...guild.channels.cache
    .filter(c =>
      c.type === ChannelType.GuildCategory &&
      (c.name.startsWith('GHOSTED Cohort-') || c.name.startsWith('archived-ghosted-cohort-'))
    )
    .values()]
    .sort((a, b) => a.position - b.position)
    .map(cat => {
      const archived = cat.name.startsWith('archived-');
      const cohortNum = archived
        ? cat.name.replace('archived-ghosted-cohort-', '')
        : cat.name.replace('GHOSTED Cohort-', '');
      const channels = guild.channels.cache.filter(c => c.parentId === cat.id);
      const teamChannels = [...channels.values()].filter(c => c.name.startsWith('ghosted-team-'));
      const cR = guild.roles.cache.find(r => r.name === roleCohort(cohortNum));
      const memberCount = cR ? guild.members.cache.filter(m => m.roles.cache.has(cR.id)).size : 0;

      return {
        id: cat.id, name: cat.name, archived, cohortNum,
        channelCount: channels.size,
        teamCount: teamChannels.length,
        memberCount
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit: verify all channels & roles for a cohort are intact
// ─────────────────────────────────────────────────────────────────────────────

async function auditCohort(guild, cohortNum) {
  await guild.channels.fetch();
  await guild.roles.fetch();

  const issues = [], ok = [];

  const cat = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === categoryName(cohortNum)
  );
  if (!cat) issues.push(`Category "${categoryName(cohortNum)}" missing`);
  else      ok.push(`Category "${categoryName(cohortNum)}" exists`);

  for (const chName of ['ghosted-announcements', 'ghosted-general']) {
    const ch = cat && guild.channels.cache.find(c => c.parentId === cat.id && c.name === chName);
    if (!ch) issues.push(`#${chName} channel missing`);
    else      ok.push(`#${chName} exists`);
  }

  for (const rName of [ROLE_GENERAL, roleCohort(cohortNum)]) {
    const r = guild.roles.cache.find(r => r.name === rName);
    if (!r) issues.push(`@${rName} role missing`);
    else     ok.push(`@${rName} exists`);
  }

  if (cat) {
    const teamChannels = guild.channels.cache.filter(
      c => c.parentId === cat.id && c.name.startsWith('ghosted-team-')
    );
    for (const [, ch] of teamChannels) {
      const teamSlug = ch.name.replace('ghosted-team-', '');
      const teamRole = guild.roles.cache.find(r => r.name === roleTeam(teamSlug));
      if (!teamRole) issues.push(`@${roleTeam(teamSlug)} role missing for #${ch.name}`);
      else            ok.push(`#${ch.name} ↔ @${roleTeam(teamSlug)} pair OK`);
    }
  }

  return { issues, ok, healthy: issues.length === 0 };
}

// ── Cohort Operations ─────────────────────────────────────────────────────────

async function bulkRemoveCohort(guild, cohortNumber, emit) {
  emit('step', { message: `🧹 Starting bulk remove for Cohort-${cohortNumber}…` });
  
  const cR = guild.roles.cache.find(r => r.name === roleCohort(cohortNumber));
  if (!cR) throw new Error(`Role ${roleCohort(cohortNumber)} not found. Nothing to remove.`);

  await guild.members.fetch();
  const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(cR.id));
  
  if (membersWithRole.size === 0) {
    emit('done', { channelCount: 0, removedCount: 0 }); // reuse payload shape roughly
    return { count: 0 };
  }

  let removedCount = 0;
  for (const [, member] of membersWithRole) {
    const rolesToRemove = member.roles.cache.filter(r => 
      r.name === 'Ghosted-general' || 
      r.name === roleCohort(cohortNumber) || 
      (r.name.startsWith('Ghosted-') && r.name !== 'Ghosted-general' && !r.name.startsWith('Ghosted-cohort-') && r.name.toLowerCase() !== 'ghosted-organizers')
    );

    if (rolesToRemove.size > 0) {
      await member.roles.remove(rolesToRemove, `Bulk removed Cohort-${cohortNumber}`);
      emit('step', { message: `  ✓ Removed roles from ${member.user.tag}` });
      removedCount++;
      await sleep(300); // Rate limit
    }
  }

  emit('done', { removedCount });
  return { count: removedCount };
}

async function transferMember(guild, cohortNumber, discordId, fromTeamSlug, toTeamSlug, emit) {
  const cR = guild.roles.cache.find(r => r.name === roleCohort(cohortNumber));
  if (!cR) throw new Error(`Role ${roleCohort(cohortNumber)} not found`);
  
  const oldTeamRole = guild.roles.cache.find(r => r.name === roleTeam(fromTeamSlug));
  const newTeamRole = guild.roles.cache.find(r => r.name === roleTeam(toTeamSlug));
  
  if (!oldTeamRole) throw new Error(`Old team role Ghosted-team-${fromTeamSlug} not found`);
  if (!newTeamRole) throw new Error(`New team role Ghosted-team-${toTeamSlug} not found`);

  let member;
  try { member = await guild.members.fetch(String(discordId)); }
  catch { throw new Error(`Discord ID ${discordId} not found in this server.`); }

  if (!member.roles.cache.has(cR.id)) {
    throw new Error(`${member.user.tag} is not in Cohort-${cohortNumber}.`);
  }
  if (!member.roles.cache.has(oldTeamRole.id)) {
    throw new Error(`${member.user.tag} is not in team ${fromTeamSlug}.`);
  }

  emit('step', { message: `Transferring ${member.user.tag} from ${fromTeamSlug} to ${toTeamSlug}…` });
  await member.roles.remove(oldTeamRole, `Transferred out of ${fromTeamSlug}`);
  await sleep(300);
  await member.roles.add(newTeamRole, `Transferred into ${toTeamSlug}`);
  
  return { name: member.user.tag };
}

async function cohortStats(guild, cohortNumber) {
  const catName = categoryName(cohortNumber);
  const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && (c.name === catName || c.name === `archived-ghosted-cohort-${cohortNumber}`));
  if (!category) throw new Error(`Category for Cohort-${cohortNumber} not found`);

  await guild.members.fetch();
  const cR = guild.roles.cache.find(r => r.name === roleCohort(cohortNumber));
  
  const stats = {};
  let totalMembers = 0;

  // We find teams by looking at the channels in category
  const teamChannels = guild.channels.cache.filter(c => c.parentId === category.id && c.name.startsWith('ghosted-team-'));
  
  teamChannels.forEach(ch => {
    const slug = ch.name.slice('ghosted-team-'.length);
    stats[slug] = { total: 0 };
  });

  if (cR) {
    const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(cR.id));
    totalMembers = membersWithRole.size;

    for (const [, member] of membersWithRole) {
      const teamRole = member.roles.cache.find(r => 
        r.name.toLowerCase().startsWith('ghosted-') && 
        r.name.toLowerCase() !== ROLE_GENERAL.toLowerCase() && 
        !r.name.toLowerCase().startsWith('ghosted-cohort-')
      );
      if (teamRole) {
        const tSlug = teamRole.name.slice('Ghosted-'.length);
        if (stats[tSlug]) stats[tSlug].total++;
        else stats[tSlug] = { total: 1 };
      }
    }
  }

  return { activeMembers: totalMembers, isArchived: category.name.startsWith('archived-'), categoryName: category.name, teamStats: stats };
}

async function exportCohort(guild, cohortNumber) {
  const cR = guild.roles.cache.find(r => r.name === roleCohort(cohortNumber));
  if (!cR) throw new Error(`Role ${roleCohort(cohortNumber)} not found`);

  await guild.members.fetch();
  const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(cR.id));
  
  let csv = 'Discord Tag,Discord ID,Team\n';

  for (const [, member] of membersWithRole) {
    const teamRole = member.roles.cache.find(r => 
      r.name.toLowerCase().startsWith('ghosted-') && 
      r.name.toLowerCase() !== ROLE_GENERAL.toLowerCase() && 
      !r.name.toLowerCase().startsWith('ghosted-cohort-')
    );
    const tSlug = teamRole ? teamRole.name.slice('Ghosted-'.length) : 'Unknown';
    csv += `"${member.user.tag}","${member.user.id}","${tSlug}"\n`;
  }

  return csv;
}

module.exports = {
  provisionCohort,
  syncCohort,
  archiveCohort,
  addMember,
  removeMember,
  listCohorts,
  auditCohort,
  bulkRemoveCohort,
  transferMember,
  cohortStats,
  exportCohort,
  categoryName,
  roleCohort,
  roleTeam,
};
