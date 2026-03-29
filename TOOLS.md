# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## GitHub CLI (gh)

- On this machine, `gh` is installed via **Snap**. Path is `/snap/bin/gh`.
- In non-interactive runs, `gh` may not resolve on PATH; fix by linking:
  - `ln -sf /snap/bin/gh ~/.local/bin/gh`
- **Snap confinement gotcha:** Snap `gh` can’t reliably operate inside **hidden directories** (e.g. `~/.openclaw/...`). If `gh` says “not a git repository” even though you’re in one, this is usually why.
  - Workarounds:
    - Run `gh` from a non-hidden repo location (e.g. `~/dev/...`), or
    - Use `gh api --repo owner/repo ...` (doesn’t need local git detection), or
    - Install a non-snap `gh` (apt) if you want full local-repo integration.
- Check auth:
  - `gh auth status`

## Local Repos

- OpenClaw-linked project repos live in `~/Repos/` so they stay outside the backup repo.
- `workspace/expense-tracker-ios`, `workspace/expense-tracker-landing`, and `workspace/fence-marketing` are symlinks back to `~/Repos/...` so existing OpenClaw paths still work.

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
