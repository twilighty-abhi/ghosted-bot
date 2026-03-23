/**
 * sheets.js
 * Fetches and parses a public Google Sheet as CSV.
 * No service account needed — sheet must be "Anyone with the link → Viewer".
 */

function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error('Could not find a Sheet ID in that URL.');
  return m[1];
}

function parseCSV(csv) {
  return csv.trim().split(/\r?\n/).map(line => {
    const cols = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  });
}

function slug(str) {
  return str.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Fetches sheet and returns:
 * {
 *   participants: [{ name, discordId, team }],
 *   teams: { "sankalp": [{ name, discordId }], ... },
 *   warnings: ["Row 3: missing Discord ID", ...]
 * }
 */
async function parseSheet(sheetUrl) {
  const sheetId = extractSheetId(sheetUrl);
  const gid = sheetUrl.match(/[#&?]gid=(\d+)/)?.[1];
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403)
      throw new Error('Sheet is not public. Share it as "Anyone with the link → Viewer".');
    throw new Error(`Google returned HTTP ${resp.status}.`);
  }
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('text/csv') && !ct.includes('text/plain') && !ct.includes('application/octet-stream'))
    throw new Error('Google did not return CSV — check the Sheet ID and make sure sharing is set to "Anyone with the link".');

  const rows   = parseCSV(await resp.text());
  if (rows.length < 2) throw new Error('Sheet has no data rows.');

  const header = rows[0].map(h => h.toLowerCase());
  const ti = header.findIndex(h => h.includes('team'));
  const ni = header.findIndex(h => h.includes('name'));
  const di = header.findIndex(h => h.includes('discord'));

  const missing = [ti < 0 && 'Team', ni < 0 && 'Name', di < 0 && 'Discord ID'].filter(Boolean);
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);

  const participants = [], warnings = [];

  rows.slice(1).forEach((row, i) => {
    const rowNum   = i + 2;
    const team      = row[ti]?.trim();
    const name      = row[ni]?.trim();
    const discordId = row[di]?.trim();

    if (!team && !name && !discordId) return; // blank row

    const isValidId = discordId && /^\d{17,19}$/.test(discordId);

    if (!name)      warnings.push(`Row ${rowNum}: missing Name`);
    if (!team)      warnings.push(`Row ${rowNum} (${name || '?'}): missing Team`);
    if (!discordId) warnings.push(`Row ${rowNum} (${name || '?'}): missing Discord ID`);
    else if (!isValidId)
      warnings.push(`Row ${rowNum} (${name}): "${discordId}" doesn't look like a valid Discord ID`);

    if (team) {
      participants.push({
        name:      name || '(no name)',
        discordId: isValidId ? discordId : null,
        team:      slug(team),
      });
    }
  });

  // Group into teams map
  const teams = {};
  for (const p of participants) {
    teams[p.team] ??= [];
    teams[p.team].push({ name: p.name, discordId: p.discordId });
  }

  // Detect duplicate slugs (two differently-named teams that slug identically)
  const slugToOriginal = {};
  for (const p of participants) {
    const orig = p.team; // already slugged
    if (slugToOriginal[orig] === undefined) slugToOriginal[orig] = orig;
  }
  // Check raw team names before slugging for collisions
  const rawTeams = {};
  rows.slice(1).forEach(row => {
    const raw = row[ti]?.trim();
    if (!raw) return;
    const s = slug(raw);
    if (!rawTeams[s]) rawTeams[s] = new Set();
    rawTeams[s].add(raw);
  });
  const collisions = Object.entries(rawTeams).filter(([, names]) => names.size > 1);
  if (collisions.length) {
    const desc = collisions.map(([s, names]) => `"${[...names].join('", "')}" → "${s}"`).join('; ');
    throw new Error(`Team name collision after slugging: ${desc}. Rename teams to be distinct.`);
  }

  return { participants, teams, warnings };
}

module.exports = { parseSheet, slug };
