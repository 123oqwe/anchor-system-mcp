# anchor-system-mcp

Cross-platform system inspection as an **MCP server**. Returns system info, installed apps, and package-manager listings on Mac / Win / Linux. Read-only.

Built as part of the [anchor](https://github.com/123oqwe/anchor-backend) personal-AI ecosystem. Replaces anchor's old macOS-only `deep-scan` + `app-registry`.

## Tools

| Tool | Description |
|------|------|
| `system_info` | Platform, arch, CPU, memory, hostname, OS details |
| `system_apps_installed` | Installed GUI apps (per-OS source: /Applications, .desktop files, Uninstall registry) |
| `system_packages` | Package manager listings: brew / dpkg / rpm / flatpak / snap / winget / choco / pip3 / npm-global |
| `system_status` | Capability matrix + detected package managers |

## Install

```bash
npx -y @anchor/system-mcp
```

## Per-platform implementations

|             | sysinfo                   | apps                              | packages                     |
|-------------|---------------------------|-----------------------------------|------------------------------|
| **macOS**   | `sw_vers`                 | `/Applications` + PlistBuddy       | `brew list`                   |
| **Linux**   | `/etc/os-release`         | `.desktop` files in standard dirs  | `dpkg/rpm/flatpak/snap`        |
| **Windows** | `Get-CimInstance` (PS)    | HKLM/HKCU Uninstall registry        | `winget` / `choco`            |

All paths are also probed on every platform: `pip3` and `npm -g` if installed.

## Use with anchor-backend

```bash
curl -X POST http://localhost:3001/api/mcp/servers -H "Content-Type: application/json" -d '{
  "name": "anchor-system",
  "command": "npx",
  "args": ["-y", "@anchor/system-mcp"]
}'
```

4 tools auto-register as `mcp_anchor_system_*`. Decision Agent + Twin can use them for cohort tagging ("DJ apps installed → music interest", "design tools + Figma → designer cohort", etc).

## Use with Claude Desktop

```json
{
  "mcpServers": {
    "anchor-system": {
      "command": "npx",
      "args": ["-y", "@anchor/system-mcp"]
    }
  }
}
```

## Privacy

- Read-only. Never modifies system state.
- No network calls.
- Lists capped at 200 per source to keep responses bounded.
- Caller decides whether to send these to a cloud LLM. anchor-backend's gate
  rules govern this in production.

## License

MIT
