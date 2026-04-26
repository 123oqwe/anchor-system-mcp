#!/usr/bin/env node
/**
 * anchor-system-mcp — cross-platform system inspection as MCP server.
 *
 * Speaks MCP 2025-06-18 over stdio. Per-OS underlying:
 *   macOS  — sw_vers + ls /Applications + PlistBuddy + brew
 *   Linux  — /etc/os-release + .desktop scan + dpkg/rpm/flatpak/snap
 *   Win    — Get-CimInstance + Uninstall registry + winget/choco
 *
 * Tools (4):
 *   system_info             — platform / arch / cpu / mem / hostname / OS details
 *   system_apps_installed   — list installed GUI apps (per-OS source)
 *   system_packages         — package manager package lists (brew/dpkg/winget/etc)
 *   system_status           — capability matrix + detected package managers
 *
 * Read-only. No network. Useful for cohort tagging (DJ apps, design apps,
 * dev stacks) and "what stack is this user on" reasoning.
 */
import { getSystemInfo, listInstalledApps, listPackages, systemStatus } from "./system.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "anchor-system-mcp", version: "0.1.0" };

interface JsonRpcRequest { jsonrpc: "2.0"; id?: number | string; method: string; params?: any }
interface JsonRpcResponse { jsonrpc: "2.0"; id: number | string; result?: any; error?: { code: number; message: string } }

const TOOLS = [
  {
    name: "system_info",
    description: "Platform, arch, CPU, memory, hostname, OS details (sw_vers/lsb_release/Get-CimInstance per-OS).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "system_apps_installed",
    description: "List installed GUI applications (Mac=/Applications, Linux=.desktop files, Win=Uninstall registry).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "system_packages",
    description: "Package manager packages: brew / dpkg / rpm / flatpak / snap / winget / choco / pip3 / npm-global. Returns one entry per detected manager.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "system_status",
    description: "Capability matrix + detected package managers + platform notes.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name: string, _args: Record<string, any>): Promise<string> {
  switch (name) {
    case "system_info": return JSON.stringify(getSystemInfo(), null, 2);
    case "system_apps_installed": return JSON.stringify(listInstalledApps(), null, 2);
    case "system_packages": return JSON.stringify(listPackages(), null, 2);
    case "system_status": return JSON.stringify(systemStatus(), null, 2);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? 0;
  if (req.method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO } };
  }
  if (req.method === "notifications/initialized") return null;
  if (req.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (req.method === "tools/call") {
    const { name, arguments: args } = req.params ?? {};
    try {
      const text = await callTool(name, args ?? {});
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (err: any) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }], isError: true } };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
}

let buffer = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", async chunk => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const req: JsonRpcRequest = JSON.parse(line);
      const res = await handleRequest(req);
      if (res) process.stdout.write(JSON.stringify(res) + "\n");
    } catch (err: any) {
      process.stderr.write(`[parse-error] ${err?.message ?? err}\n`);
    }
  }
});
process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

process.stderr.write(`[anchor-system-mcp] ready on stdio (platform=${process.platform})\n`);
