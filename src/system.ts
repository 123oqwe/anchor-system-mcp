/**
 * Per-OS system inspection. Each function detects platform and dispatches
 * to the right native command. Returns shape is uniform across platforms.
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PLATFORM = process.platform;
const HOME = os.homedir();

function safeExec(cmd: string, opts: { timeout?: number } = {}): string {
  try {
    return execSync(cmd, { timeout: opts.timeout ?? 8000, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }).trim();
  } catch { return ""; }
}

function checkBinary(bin: string): boolean {
  const which = PLATFORM === "win32" ? "where" : "which";
  const r = spawnSync(which, [bin], { encoding: "utf-8" });
  return r.status === 0;
}

// ── system_info ─────────────────────────────────────────────────────────────

export interface SystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  release: string;
  hostname: string;
  user: string;
  shell: string;
  cores: number;
  memTotalGB: number;
  memFreeGB: number;
  uptimeHours: number;
  homeDir: string;
  osDetails?: string;  // sw_vers (Mac) / lsb_release (Linux) / Get-ComputerInfo summary (Win)
}

export function getSystemInfo(): SystemInfo {
  let osDetails = "";
  if (PLATFORM === "darwin") {
    osDetails = safeExec("sw_vers");
  } else if (PLATFORM === "linux") {
    osDetails = safeExec("cat /etc/os-release") || safeExec("uname -a");
  } else if (PLATFORM === "win32") {
    osDetails = safeExec("powershell -Command \"(Get-CimInstance Win32_OperatingSystem | Select Caption,Version,OSArchitecture | Format-List | Out-String).Trim()\"");
  }
  return {
    platform: PLATFORM,
    arch: process.arch,
    release: os.release(),
    hostname: os.hostname(),
    user: os.userInfo().username,
    shell: process.env.SHELL ?? process.env.ComSpec ?? "",
    cores: os.cpus().length,
    memTotalGB: Math.round(os.totalmem() / (1024 ** 3)),
    memFreeGB: Math.round(os.freemem() / (1024 ** 3)),
    uptimeHours: Math.round(os.uptime() / 3600),
    homeDir: HOME,
    osDetails: osDetails.slice(0, 800) || undefined,
  };
}

// ── system_apps_installed ───────────────────────────────────────────────────

export interface InstalledApp { name: string; bundleId?: string; version?: string; source: string }

export function listInstalledApps(): { apps: InstalledApp[]; total: number; sources: string[] } {
  const apps: InstalledApp[] = [];
  const sources: string[] = [];

  if (PLATFORM === "darwin") {
    sources.push("/Applications", `${HOME}/Applications`);
    for (const dir of ["/Applications", path.join(HOME, "Applications")]) {
      try {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
          if (!entry.endsWith(".app")) continue;
          const name = entry.replace(/\.app$/, "");
          const plistPath = path.join(dir, entry, "Contents", "Info.plist");
          let bundleId: string | undefined;
          let version: string | undefined;
          try {
            // PlistBuddy is built-in on Mac
            bundleId = safeExec(`/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "${plistPath}"`) || undefined;
            version  = safeExec(`/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "${plistPath}"`) || undefined;
          } catch {}
          apps.push({ name, bundleId, version, source: dir });
        }
      } catch {}
    }
  } else if (PLATFORM === "linux") {
    sources.push("/usr/share/applications", `${HOME}/.local/share/applications`);
    for (const dir of ["/usr/share/applications", path.join(HOME, ".local/share/applications")]) {
      try {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
          if (!entry.endsWith(".desktop")) continue;
          const fullPath = path.join(dir, entry);
          let name = entry.replace(/\.desktop$/, "");
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            const m = content.match(/^Name=(.+)$/m);
            if (m) name = m[1].trim();
          } catch {}
          apps.push({ name, source: dir });
        }
      } catch {}
    }
  } else if (PLATFORM === "win32") {
    sources.push("HKLM Uninstall registry");
    const ps = `Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName } | Select-Object DisplayName, DisplayVersion | ConvertTo-Json -Compress`;
    const out = safeExec(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`);
    if (out) {
      try {
        const arr = JSON.parse(out);
        const list = Array.isArray(arr) ? arr : [arr];
        for (const item of list) {
          if (item?.DisplayName) {
            apps.push({ name: String(item.DisplayName), version: item.DisplayVersion ? String(item.DisplayVersion) : undefined, source: "registry" });
          }
        }
      } catch {}
    }
    sources.push("user Uninstall registry");
    const psUser = `Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Where-Object { $_.DisplayName } | Select-Object DisplayName, DisplayVersion | ConvertTo-Json -Compress`;
    const outUser = safeExec(`powershell -NoProfile -Command "${psUser.replace(/"/g, '\\"')}"`);
    if (outUser) {
      try {
        const arr = JSON.parse(outUser);
        const list = Array.isArray(arr) ? arr : [arr];
        for (const item of list) {
          if (item?.DisplayName) {
            apps.push({ name: String(item.DisplayName), version: item.DisplayVersion ? String(item.DisplayVersion) : undefined, source: "user-registry" });
          }
        }
      } catch {}
    }
  }

  // Dedup by name
  const seen = new Map<string, InstalledApp>();
  for (const a of apps) {
    if (!seen.has(a.name)) seen.set(a.name, a);
  }
  return { apps: Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)), total: seen.size, sources };
}

// ── system_packages (dev tools / cli stuff) ────────────────────────────────

export interface Packages { manager: string; count: number; packages: string[]; available: boolean }

export function listPackages(): Packages[] {
  const out: Packages[] = [];

  if (checkBinary("brew")) {
    const list = safeExec("brew list --formula").split("\n").filter(Boolean);
    out.push({ manager: "brew", count: list.length, packages: list.slice(0, 200), available: true });
    const casks = safeExec("brew list --cask").split("\n").filter(Boolean);
    out.push({ manager: "brew-cask", count: casks.length, packages: casks.slice(0, 100), available: true });
  }
  if (checkBinary("dpkg")) {
    const list = safeExec("dpkg-query -f '${Package}\\n' -W").split("\n").filter(Boolean);
    out.push({ manager: "dpkg", count: list.length, packages: list.slice(0, 200), available: true });
  }
  if (checkBinary("rpm")) {
    const list = safeExec("rpm -qa --queryformat '%{NAME}\\n'").split("\n").filter(Boolean);
    out.push({ manager: "rpm", count: list.length, packages: list.slice(0, 200), available: true });
  }
  if (checkBinary("flatpak")) {
    const list = safeExec("flatpak list --app --columns=application").split("\n").filter(l => l && !l.startsWith("Application"));
    if (list.length) out.push({ manager: "flatpak", count: list.length, packages: list, available: true });
  }
  if (checkBinary("snap")) {
    const list = safeExec("snap list").split("\n").slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean);
    if (list.length) out.push({ manager: "snap", count: list.length, packages: list, available: true });
  }
  if (PLATFORM === "win32" && (checkBinary("winget") || checkBinary("choco"))) {
    if (checkBinary("winget")) {
      const list = safeExec("winget list --accept-source-agreements").split("\n").slice(2).map(l => l.split(/\s{2,}/)[0]).filter(Boolean);
      out.push({ manager: "winget", count: list.length, packages: list.slice(0, 200), available: true });
    }
    if (checkBinary("choco")) {
      const list = safeExec("choco list --local-only").split("\n").slice(0, -1).map(l => l.split(" ")[0]).filter(Boolean);
      out.push({ manager: "choco", count: list.length, packages: list.slice(0, 200), available: true });
    }
  }
  if (checkBinary("pip3")) {
    const list = safeExec("pip3 list --format=freeze").split("\n").map(l => l.split("==")[0]).filter(Boolean);
    out.push({ manager: "pip3", count: list.length, packages: list.slice(0, 100), available: true });
  }
  if (checkBinary("npm")) {
    const list = safeExec("npm list -g --depth=0 --parseable").split("\n").slice(1).map(l => path.basename(l)).filter(Boolean);
    out.push({ manager: "npm-global", count: list.length, packages: list.slice(0, 100), available: true });
  }

  return out;
}

// ── system_status (capability matrix) ──────────────────────────────────────

export function systemStatus(): {
  platform: NodeJS.Platform;
  arch: string;
  appsLookupAvailable: boolean;
  packageManagersDetected: string[];
  notes: string[];
} {
  const notes: string[] = [];
  let appsLookupAvailable = false;
  if (PLATFORM === "darwin") { appsLookupAvailable = fs.existsSync("/Applications"); }
  else if (PLATFORM === "linux") { appsLookupAvailable = fs.existsSync("/usr/share/applications"); }
  else if (PLATFORM === "win32") { appsLookupAvailable = checkBinary("powershell"); if (!appsLookupAvailable) notes.push("powershell not on PATH"); }
  else { notes.push(`Unsupported platform ${PLATFORM}`); }

  const managers: string[] = [];
  for (const m of ["brew", "dpkg", "rpm", "flatpak", "snap", "winget", "choco", "pip3", "npm"]) {
    if (checkBinary(m)) managers.push(m);
  }
  return { platform: PLATFORM, arch: process.arch, appsLookupAvailable, packageManagersDetected: managers, notes };
}
