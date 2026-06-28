# session-radar

A VS Code extension that shows the status of multiple **Claude Code (tmux) sessions** at a glance and lets you jump to / open any of them.

Built for a remote workflow (Claude Code CLI running in tmux on a remote/WSL host, accessed over VS Code Remote/SSH/Tunnel), but works anywhere tmux + Claude Code do.

## Features

- **Two views** (use either): a native **tree** and a compact **card** view, side by side.
- **Live status** per session: 🔴 working · 🟡 waiting for input · 🟢 idle/done · ⚪ unknown.
- **Auto-discovery** of running tmux sessions, plus your own groups.
- **Open / jump**: click a session to focus its terminal, or open it (`tmux new-session -A` — attach if it exists, else create).
- **Manage**: create/rename/delete groups, rename (display alias) / hide / add sessions, and **drag-and-drop** to reorder or regroup — in either view.
- **Persistent** layout (groups, order, aliases) across restarts.

Real tmux sessions are never killed or renamed — rename sets a display alias, delete just hides from the list.

## How it works

A small Claude Code hook writes each session's state to `~/.claude/session-status/<name>.json`; the extension watches that directory and renders the panel. Your layout (groups/order/aliases/hidden) lives in `~/.claude/session-radar/layout.json`.

## Install

See **[docs/INSTALL.md](docs/INSTALL.md)** — build the `.vsix`, drop in the hook script, wire the hooks (preserving any existing ones), and install the extension on the remote host.

## Status

Working (v0.0.x). Personal tool, shared as-is.
