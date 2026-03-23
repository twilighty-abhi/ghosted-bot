const { SlashCommandBuilder } = require('discord.js');

module.exports = [

  // ── /create_cohort ─────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('create_cohort')
    .setDescription('Create a GHOSTED cohort: category, channels, roles, and assign members')
    .addIntegerOption(o =>
      o.setName('cohort_number')
        .setDescription('Cohort number, e.g. 2 → "GHOSTED Cohort-2"')
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(o =>
      o.setName('sheet_url')
        .setDescription('Public Google Sheet URL with participant data')
        .setRequired(true)
    ),

  // ── /archive_cohort ────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('archive_cohort')
    .setDescription('Lock a finished cohort (read-only) and move it to the archive')
    .addIntegerOption(o =>
      o.setName('cohort_number')
        .setDescription('Cohort number to archive')
        .setRequired(true)
        .setMinValue(1)
    ),

  // ── /add_member ────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('add_member')
    .setDescription('Add a late participant to an existing cohort and team')
    .addIntegerOption(o =>
      o.setName('cohort_number')
        .setDescription('Cohort number')
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(o =>
      o.setName('team')
        .setDescription('Team name, e.g. sankalp')
        .setRequired(true)
    )
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Discord user to add')
        .setRequired(true)
    ),

  // ── /list_cohorts ──────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('list_cohorts')
    .setDescription('List all active GHOSTED cohorts and their teams'),

];
