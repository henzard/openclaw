# Deployment Guide — Custom OpenClaw Build

Step-by-step guide to deploy the WhatsApp archive, Habitica tool, and
faster-whisper integration to a production Linux VM that currently runs OpenClaw
from the official installer.

---

## Prerequisites

| Requirement | Check command | Notes |
|---|---|---|
| Node 22+ (24 recommended) | `node -v` | The installer likely already set this up |
| pnpm | `pnpm -v` | `npm i -g pnpm` if missing |
| git | `git --version` | Should already be present |
| ffmpeg | `ffmpeg -version` | Required for Whisper audio decoding |
| faster-whisper | `faster-whisper --help` | Local audio transcription |

---

## Part 1 — One-Time Setup (first deployment only)

### Step 1: Push your changes to a remote fork

On your **dev machine** (Windows), push all changes to a Git remote
(GitHub/GitLab/etc.):

```bash
cd C:\Project\openclaw
git remote add myfork git@github.com:<you>/openclaw.git   # if not already done
git add -A
git commit -m "feat: WhatsApp archive, Habitica tool, faster-whisper integration"
git push myfork main
```

### Step 2: Install system dependencies on the VM

SSH into your Linux VM:

```bash
ssh user@your-vm
```

Install ffmpeg (required for Whisper to decode OGG/Opus audio):

```bash
sudo apt update && sudo apt install -y ffmpeg python3 python3-pip
```

Install faster-whisper CLI:

```bash
pip3 install faster-whisper
```

Verify:

```bash
ffmpeg -version
faster-whisper --help
```

### Step 3: Download the large-v3 model (one-time)

The first transcription will auto-download the model, but it is better to do
this once manually so the gateway doesn't hang on the first voice note:

```bash
faster-whisper --model large-v3 /dev/null 2>&1 || true
```

This downloads ~3 GB. On a CPU-only VM expect ~30-60s per 30s audio clip.

### Step 4: Stop the running gateway

```bash
openclaw gateway stop
```

Verify it stopped:

```bash
openclaw gateway status
```

### Step 5: Clone your fork on the VM

```bash
cd ~
git clone https://github.com/<you>/openclaw.git openclaw-custom
cd ~/openclaw-custom
```

Add the official upstream as a second remote (for future updates):

```bash
git remote add upstream https://github.com/openclaw/openclaw.git
```

### Step 6: Install dependencies and build

```bash
pnpm install
pnpm build
```

If you see `sharp` build errors:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 pnpm install
pnpm build
```

### Step 7: Link the custom build globally

This replaces the old npm-installed `openclaw` binary with your custom build:

```bash
sudo npm i -g .
```

Verify the binary now points to your custom build:

```bash
which openclaw
openclaw --version
```

### Step 8: Run doctor

```bash
openclaw doctor
```

This migrates any config changes and verifies the install is healthy.

### Step 9: Configure the new features

Edit your OpenClaw config:

```bash
nano ~/.openclaw/openclaw.json
```

Add/update the WhatsApp archive config under your WhatsApp account:

```jsonc
{
  "channels": {
    "whatsapp": {
      "accounts": {
        "default": {
          // ... your existing whatsapp config ...
          "archive": {
            "enabled": true,
            "retentionDays": 90,
            "persistAudio": true
          }
        }
      }
    }
  }
}
```

For Habitica, add environment variables. Edit the systemd service or your
shell profile:

```bash
# Option A: systemd override (recommended for services)
systemctl --user edit openclaw-gateway.service
```

Add:

```ini
[Service]
Environment="HABITICA_USER_ID=your-habitica-user-id"
Environment="HABITICA_API_KEY=your-habitica-api-key"
```

Or alternatively set them in `~/.bashrc` / `~/.profile`:

```bash
export HABITICA_USER_ID="your-habitica-user-id"
export HABITICA_API_KEY="your-habitica-api-key"
```

Get these values from: Habitica → Settings → API.

Optionally, override the Whisper model (default is already `large-v3`):

```bash
export WHISPER_MODEL="large-v3"
```

### Step 10: Restart the gateway

```bash
openclaw gateway restart
```

Verify everything is running:

```bash
openclaw gateway status
openclaw health
openclaw logs --follow
```

Look for these log lines to confirm the new features loaded:

```
[whatsapp] [default] WhatsApp archive enabled at ~/.openclaw/whatsapp/archive.sqlite
[plugins] habitica: loaded
```

### Step 11: Verify the new features

Test the WhatsApp archive tool by asking your agent:

> "What happened on WhatsApp today?"

Test the Habitica tool:

> "Show me my Habitica dashboard"

Test voice note transcription by sending a voice note on WhatsApp and checking
that the agent responds with a text-based reply.

---

## Part 2 — Routine Updates

When upstream OpenClaw releases a new version and you want to pull it in while
keeping your custom changes:

### Step 1: SSH into the VM

```bash
ssh user@your-vm
cd ~/openclaw-custom
```

### Step 2: Fetch upstream changes

```bash
git fetch upstream
```

### Step 3: Merge upstream into your branch

```bash
git merge upstream/main
```

If there are merge conflicts, resolve them:

```bash
# Edit conflicting files
git add .
git commit
```

### Step 4: Rebuild

```bash
pnpm install
pnpm build
```

### Step 5: Re-link and restart

```bash
sudo npm i -g .
openclaw doctor
openclaw gateway restart
```

### Step 6: Verify

```bash
openclaw health
openclaw logs --follow
```

---

## Part 3 — Pushing changes from dev to prod

When you make new changes on your Windows dev machine:

### On your dev machine

```bash
git add -A
git commit -m "description of changes"
git push myfork main
```

### On the VM

```bash
cd ~/openclaw-custom
git pull origin main
pnpm install
pnpm build
sudo npm i -g .
openclaw gateway restart
```

---

## Rollback

If something breaks after an update:

### Option A: Roll back to previous commit

```bash
cd ~/openclaw-custom
git log --oneline -10          # find the last good commit
git checkout <good-commit-sha>
pnpm install
pnpm build
sudo npm i -g .
openclaw gateway restart
```

To return to latest after fixing:

```bash
git checkout main
```

### Option B: Fall back to official OpenClaw

If the custom build is causing issues and you need to get back to a working
state quickly:

```bash
npm i -g openclaw@latest
openclaw doctor
openclaw gateway restart
```

This replaces the custom build with the official release. Your config and
data in `~/.openclaw/` are preserved.

---

## Quick Reference

| Task | Command |
|---|---|
| Check status | `openclaw gateway status` |
| View logs | `openclaw logs --follow` |
| Restart | `openclaw gateway restart` |
| Stop | `openclaw gateway stop` |
| Health check | `openclaw health` |
| Run diagnostics | `openclaw doctor` |
| Check archive DB | `sqlite3 ~/.openclaw/whatsapp/archive.sqlite "SELECT COUNT(*) FROM whatsapp_messages;"` |
| Prune archive manually | Happens automatically every 24h based on `retentionDays` |

---

## Cron Delivery to WhatsApp

The cron system already supports WhatsApp delivery. Add jobs to your config:

```jsonc
{
  "cron": {
    "jobs": [
      {
        "id": "habitica-reminder",
        "schedule": "0 9 * * *",
        "prompt": "Check my Habitica dashboard and remind me of overdue dailies and incomplete todos",
        "delivery": {
          "channel": "whatsapp",
          "to": "default"
        }
      },
      {
        "id": "whatsapp-digest",
        "schedule": "0 18 * * *",
        "prompt": "Give me a summary of what happened on WhatsApp today",
        "delivery": {
          "channel": "whatsapp",
          "to": "default"
        }
      }
    ]
  }
}
```

- `schedule` uses standard cron syntax (the examples above: 9 AM and 6 PM daily)
- `delivery.to` is the WhatsApp account ID or a specific JID
- The agent will use the new tools (whatsapp_archive, habitica) automatically
  when the prompt references them
