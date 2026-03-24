# GHOSTED Bot
*Built by Abhiram ([abhiramnj.com](https://abhiramnj.com))*

Discord bot for provisioning GHOSTED cohorts from Google Sheets.

---

## What it creates
## Features

- **🚀 Automated Provisioning**: Creates necessary roles (e.g., `Ghosted-cohort-2`, `Ghosted-team-voice-of-needy`) and private team channels based on a Google Sheet.
- **🔄 Sync**: Add new late-joiners without recreating existing channels.
- **🧹 Bulk Operations**: Remove all GHOSTED roles from an entire cohort at once, or transfer members between teams.
- **📡 Communication**: Broadcast announcements to a cohort or send DMs to an entire team at once.
- **🤖 Automation**: Automatically assigns roles when participants join the Server and detects/logs when they leave.
- **📦 Archiving**: Safely lock and archive a cohort when it ends (on-demand or via automated schedule).
- **🔒 Secure Dashboard**: Password-protected, SQLite-session-backed web interface to manage operations without using Discord commands.
- **📊 Observability**: Built-in cohort stats, CSV exports, persistent Activity Logs, and Discord webhook notifications.

## Sheet format

Row 1 must be headers. Required columns (names are flexible, just must contain the keyword):

| Team | Name | Discord ID |
|---|---|---|
| organisation 1 | Rahul | 123456789012345678 |
| organisation 2 | Neha | 987654321098765432 |

- **Discord ID** = 18-digit user ID (not username). Enable Developer Mode → right-click user → Copy User ID.
- Sheet must be shared as **"Anyone with the link → Viewer"**.

---

## Setup

### 1. Install
```bash
npm install
cp .env.example .env
```

### 2. Fill .env
```
DISCORD_TOKEN="your_bot_token"
CLIENT_ID="your_client_id"
GUILD_ID="your_server_id"

# Web Dashboard
GUI_PORT=3000

# Auth & Security (Required)
DASHBOARD_PASSWORD="changeme_to_secure_password"
SESSION_SECRET="generate_random_long_string"

# Optional enhancements
BOT_LOG_CHANNEL_ID="channel_id_for_webhooks_and_leave_alerts"

# Active cohort category (Optional: defaults to none)
ACTIVE_CATEGORY_ID="optional_parent_category_id_for_active_cohorts"
```

The database (`ghosted.db`) will be automatically created in the root directory upon first run. It will use `DASHBOARD_PASSWORD` to create the initial `admin` user.

### 3. Bot permissions
When inviting the bot, it needs:
- Manage Roles
- Manage Channels
- View Channels
- Send Messages

Scopes: `bot` + `applications.commands`

**Important:** The bot's role must be placed ABOVE the roles it creates in Server Settings → Roles.

### 4. Deploy slash commands (once)
```bash
node src/deploy-commands.js
```

---

## Running

### Option A — Slash command in Discord
```bash
npm start
```
Then use `/create_cohort`, `/archive_cohort`, `/add_member`, `/list_cohorts` in your server.

### Option B — GUI in browser (recommended for provisioning)
```bash
npm run gui
# open http://localhost:3000
```
Enter cohort number + sheet URL → Preview → Provision.

---

## Commands

| Command | Description |
|---|---|
| `/create_cohort cohort_number sheet_url` | Full provisioning from sheet |
| `/archive_cohort cohort_number` | Lock cohort read-only, rename to archived |
| `/add_member cohort_number team user` | Add a late participant |
| `/list_cohorts` | Show all active cohorts |

---

## File structure
```
ghosted-bot/
├── src/
│   ├── index.js           # Bot entry point
│   ├── server.js          # GUI Express server
│   ├── commands.js        # Slash command definitions
│   ├── handlers.js        # Slash command logic
│   ├── provision.js       # Core provisioning (shared by bot + GUI)
│   ├── sheets.js          # Google Sheets CSV parser
│   └── deploy-commands.js # One-time command registration
├── public/
│   └── index.html         # Browser GUI
├── .env.example
├── package.json
└── README.md
```
