# Simoder-UI-Inspector

[![Download Latest (Nightly)](https://img.shields.io/github/last-commit/SimCity13-Modders/Simoder-UI-Inspector/main?label=Download%20latest%20(nightly)&logo=github)](https://github.com/SimCity13-Modders/Simoder-UI-Inspector/archive/refs/heads/main.zip)
[![Download Latest Release](https://img.shields.io/github/v/release/SimCity13-Modders/Simoder-UI-Inspector?label=Download%20latest%20release&logo=github)](https://github.com/SimCity13-Modders/Simoder-UI-Inspector/releases/latest)
[![Star](https://img.shields.io/github/stars/SimCity13-Modders/Simoder-UI-Inspector?style=social)](https://github.com/SimCity13-Modders/Simoder-UI-Inspector/stargazers)

**Simoder-UI-Inspector** (`simoder.ui_inspector`) is a standalone, Chrome DevTools-style in-game DOM & CSS inspector overlay for **SimCity (2013)**'s `EAWebKit` UI, built for **Simoder**. It lets modders and AI agents hover-pick live UI elements, inspect selectors, bounding rects, matched CSS rules, and computed styles, copy AI-ready Markdown summaries, and optionally expose DOM inspection tools over **Simoder-MCP**.

## Dependencies & Requirements

- **Runtime**: [Simoder](https://github.com/SimCity13-Modders/Simoder) (`d3d9.dll`)
- **Base Mod**: [Simoder-Base](https://github.com/SimCity13-Modders/Simoder-Base) (`mods/simoder.base`)
- **Optional**: [Simoder-MCP](https://github.com/SimCity13-Modders/Simoder-MCP) (`mods/simoder.devtools`) if you want AI/MCP clients to query the live DOM remotely
- **Trust Approval**: Uses a `dev_ui` DOM overlay (`dev_ui/inspector.js`), which requires one-time SHA-256 approval in **Mods → Native DLLs** (no `config.toon` edits needed).

## Installation

1. Install [Simoder](https://github.com/SimCity13-Modders/Simoder) and [Simoder-Base](https://github.com/SimCity13-Modders/Simoder-Base).
2. Download `Simoder-UI-Inspector` from the **Release** or **Nightly** badge above (or clone this repository).
3. Copy the mod folder into `<SimCity Install>\mods\simoder.ui_inspector\`:

```text
<SimCity Install>/
  mods/
    simoder.ui_inspector/
      mod.toml
      dev_ui/
        inspector.js
        keybinds.json
        mcp_tools.json
```

4. Launch SimCity, open **Mods → Native DLLs**, and click **Approve** on **Simoder UI Inspector (DevTools)**.

---

## Default Keybinds

All keybinds are customizable in **Mods → Keybinds**:

| Action | Default Keybind | Description |
| --- | --- | --- |
| `toggle_picker` | `Ctrl+Shift+O` | Toggle hover-and-click DOM element picker mode |
| `toggle_panel` | `Ctrl+Alt+I` | Show or hide the docked UI Inspector overlay panel |

## Optional MCP Tools (`simoder.ui_inspector.*`)

When [Simoder-MCP](https://github.com/SimCity13-Modders/Simoder-MCP) is active, `simoder.ui_inspector` registers 5 optional tools in Simoder's `HostToolRegistry`:

| Tool | Required Grant | Purpose |
| --- | --- | --- |
| `simoder.ui_inspector.toggle` | `ui.input` | Show/hide the inspector panel or toggle `Ctrl+Shift+O` element picker mode |
| `simoder.ui_inspector.get_selection` | `session.read` | Return selector, ancestors, rect, matched CSS rules, computed styles, and AI Markdown for the selected element |
| `simoder.ui_inspector.get_dom_tree` | `session.read` | Return a bounded DOM tree snapshot from `rootSelector` (default `body`) |
| `simoder.ui_inspector.query_dom` | `session.read` | Query elements in the active `EAWebKit` view by CSS selector |
| `simoder.ui_inspector.highlight` | `ui.input` | Highlight and optionally select a DOM element matching a CSS selector |
