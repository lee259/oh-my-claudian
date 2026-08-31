# Oh My Claudian

![Preview](assets/Preview.png)

Oh My Claudian is an [Obsidian](https://obsidian.md/) plugin that brings coding agents into your vault. It provides one sidebar chat and inline-edit workflow while preserving the native capabilities and configuration of each provider.

[Install from Obsidian Community Plugins](https://community.obsidian.md/plugins/oh-my-claudian) · [View on GitHub](https://github.com/lee259/oh-my-claudian)

This project started as a fork of [Claudian](https://github.com/YishenTu/claudian). It is now a maintained, local-first workspace for multiple coding-agent providers.

## Supported providers

The built-in provider integrations are:

- [Claude Code](https://code.claude.com/docs/en/overview)
- [Codex](https://github.com/openai/codex)
- [Cursor Agent](https://cursor.com/docs/cli/overview)
- [Grok](https://github.com/xai-org/grok-build)
- [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://github.com/earendil-works/pi)

Provider capabilities are intentionally different. The plugin exposes controls only when the selected provider supports them; model discovery, permissions, history, planning, MCP, and runtime behavior remain provider-specific.

## What it provides

- Sidebar chat with multiple tabs, conversation history, resume, fork, and compact.
- Single-panel and dual-pane layouts with vault navigation and session management.
- Inline editing with a word-level diff preview.
- Slash commands, skills, `@` mentions, instruction mode, and Mermaid rendering.
- Model discovery, readiness diagnostics, provider-specific permissions and planning controls where available.
- File and folder attachments from Obsidian or your desktop as clickable context chips.
- External-file access boundaries and approval-aware write handling.
- Internationalized UI with 10 locales, including Simplified and Traditional Chinese.

## Requirements

- Obsidian 1.7.2 or newer on macOS, Linux, or Windows.
- At least one supported provider CLI installed and authenticated according to its own documentation.
- A compatible subscription or API provider.

## Installation

### Community Plugins

1. Open **Settings → Community plugins → Browse** in Obsidian.
2. Search for **Oh My Claudian**, install it, and enable it.

You can also open the [Oh My Claudian community plugin page](https://community.obsidian.md/plugins/oh-my-claudian) directly.

### From source

```bash
cd /path/to/vault/.obsidian/plugins
git clone https://github.com/lee259/oh-my-claudian.git
cd oh-my-claudian
pnpm install
pnpm run build
```

Then enable the plugin under **Settings → Community plugins**.

## Quick start

1. Open **Settings → Oh My Claudian** and choose a provider tab.
2. Enable the provider, check its **Readiness** panel, and select a chat model.
3. Open the chat sidebar from the ribbon icon or command palette and send a message.

Use `/` for commands and skills, `@` to reference vault files or provider resources, and drag files or folders into the composer to attach them. Select note text and use the inline-edit command to preview and apply changes.

Each provider CLI is installed, authenticated, and configured outside the plugin. If Obsidian cannot find a CLI, leave automatic detection enabled first; otherwise set the provider's executable path in its settings tab. OMP and Cursor require separate CLI login, for example `agent login` for Cursor Agent.

## Safety and privacy

Oh My Claudian is local-first and does not send telemetry. Your prompts, attachments, and tool results are sent to the provider you select and its configured model services. Network access is otherwise limited to explicit provider work and configured MCP endpoints.

The vault is the agent's working directory, not an operating-system security boundary. A local CLI, shell command, MCP server, plugin, or child process may access files, network services, and credentials available to your OS account. Safe/approval mode reduces accidental actions but cannot guarantee isolation. Review provider permissions carefully, especially before enabling YOLO, bash mode, browser access, MCP servers, or external context paths.

External files are attached explicitly as context. Attaching or mentioning a file does not grant write access; direct edits outside the vault are subject to the provider approval flow when supported.

## Development

```bash
pnpm install
pnpm run dev
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

`pnpm run dev` watches TypeScript, styles, and `manifest.json`. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution, validation, and release guidance.

## License

Licensed under the [MIT License](LICENSE).
