/**
 * Pengelola Aplikasi Native Rust `Baileys Backup` (`bin/BaileysBackup.exe`) untuk Windows:
 * - `node scripts/watchdog-ctl.mjs build`     : Kompilasi TypeScript (`dist/`) + binary Rust (`bin/BaileysBackup.exe` + `.ico`)
 * - `node scripts/watchdog-ctl.mjs install`   : Build/pasang ke LocalAppData, daftarkan ke Windows Startup, Windows Search, System Tray, & jalankan
 *   - `--exe <path>` / `--from <path>`        : Pasang binary `.exe` prebuilt (mis. unduhan GitHub Release) tanpa compile Rust lokal
 *   - `--skip-rust`                           : Pakai `bin/BaileysBackup.exe` yang sudah ada tanpa memanggil `cargo build`
 * - `node scripts/watchdog-ctl.mjs start`     : Jalankan `Baileys Backup` di System Tray tanpa jendela terminal
 * - `node scripts/watchdog-ctl.mjs status`    : Tampilkan status live Baileys Backup, status VPS, pemakaian RAM (MB), Tray, Startup, & Search Index
 * - `node scripts/watchdog-ctl.mjs stop`      : Hentikan Baileys Backup (dan sync sesi bila backup lokal sedang aktif)
 * - `node scripts/watchdog-ctl.mjs uninstall` : Hentikan Baileys Backup, hapus dari Windows Startup & Start Menu Search
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const RUST_DIR = path.join(ROOT_DIR, 'tools', 'wa-standby-watchdog');
const RUST_TARGET_EXE = path.join(RUST_DIR, 'target', 'release', 'BaileysBackup.exe');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const BIN_EXE = path.join(BIN_DIR, 'BaileysBackup.exe');
const LEGACY_BIN_EXE = path.join(BIN_DIR, 'wa-standby-watchdog.exe');
const ICON_ICO = path.join(BIN_DIR, 'baileys-backup.ico');
const INSTALL_DIR =
  process.platform === 'win32'
    ? path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Programs',
        'BaileysBackup',
      )
    : BIN_DIR;
const INSTALLED_EXE = path.join(INSTALL_DIR, 'BaileysBackup.exe');
const INSTALLED_ICO = path.join(INSTALL_DIR, 'baileys-backup.ico');
const LOG_FILE = path.join(ROOT_DIR, 'logs', 'wa-standby-watchdog.log');
const CONTROL_PORT = 47831;
const CONTROL_HOST = '127.0.0.1';
const REG_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_VALUE_NAME = 'BaileysBackup';
const LEGACY_REG_VALUE_NAME = 'FreeAIBotStandbyWatchdog';
const REG_APP_KEY = 'HKCU\\Software\\BaileysBackup';

function getStartMenuShortcutPath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Baileys Backup.lnk');
}

function sendControlCommand(cmd, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buf = '';
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {}
      resolve(val);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.write(`${cmd}\n`);
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (buf.includes('\n')) {
        try {
          finish(JSON.parse(buf.trim()));
        } catch {
          finish({ ok: true, raw: buf.trim() });
        }
      }
    });
    socket.on('timeout', () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('close', () => finish(null));
    socket.connect(CONTROL_PORT, CONTROL_HOST);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function stopWatchdogIfRunning() {
  const status = await sendControlCommand('STATUS', 1500);
  if (status) {
    console.log(`[baileys-backup] Menghentikan instance aktif (PID ${status.watchdogPid})...`);
    await sendControlCommand('STOP', 5000);
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      const again = await sendControlCommand('STATUS', 600);
      if (!again) break;
    }
  }
  if (process.platform === 'win32') {
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          "Get-Process -Name 'BaileysBackup' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
        ],
        { stdio: 'ignore', windowsHide: true },
      );
      await sleep(150);
    } catch {}
  }
}

function stopLegacyHeavyTsxStandbyProcesses() {
  if (process.platform !== 'win32') return;
  try {
    const selfPid = process.pid;
    const parentPid = process.ppid || 0;
    const psScript = [
      `$procs = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'wa-standby-watchdog.exe') -or ($_.Name -eq 'node.exe' -and $_.ProcessId -ne ${selfPid} -and $_.ProcessId -ne ${parentPid} -and $_.CommandLine -match 'whatsapp_baileys\\.(?:ts|js).*--standby') };`,
      'foreach ($p in $procs) {',
      '  Write-Output ("Stopping legacy standby process " + $p.Name + " PID " + $p.ProcessId);',
      '  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue;',
      '}',
    ].join(' ');
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    if (out) console.log(out);
  } catch {
    // abaikan bila tidak ada proses lama
  }
}

function flushWindowsShellIconCache() {
  if (process.platform !== 'win32') return;
  try {
    const psCmd = [
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ShellNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2); }';`,
      `[ShellNotify]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)`,
    ].join(' ');
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd],
      { stdio: 'ignore', windowsHide: true },
    );
  } catch {}
}

function deployToLocalAppData() {
  if (process.platform !== 'win32') return;
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  // Tulis ulang byte-per-byte agar file di C:\Users\...\AppData\Local\Programs mewarisi ACL standar Medium Integrity (bukan Low Mandatory Level dari folder repo).
  fs.writeFileSync(INSTALLED_EXE, fs.readFileSync(BIN_EXE));
  if (fs.existsSync(ICON_ICO)) {
    fs.writeFileSync(INSTALLED_ICO, fs.readFileSync(ICON_ICO));
  }
  execFileSync(
    'reg.exe',
    ['add', REG_APP_KEY, '/v', 'ProjectRoot', '/t', 'REG_SZ', '/d', ROOT_DIR, '/f'],
    { stdio: 'ignore', windowsHide: true },
  );
  flushWindowsShellIconCache();
  console.log(`[baileys-backup] Terpasang di LocalAppData (Medium Integrity): ${INSTALLED_EXE}`);
}

function parseCliArgs(argv) {
  let action = 'status';
  let prebuiltExe = '';
  let skipRust = false;
  let actionSet = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-rust') {
      skipRust = true;
    } else if (arg.startsWith('--exe=')) {
      prebuiltExe = arg.slice('--exe='.length).trim();
    } else if (arg.startsWith('--from=')) {
      prebuiltExe = arg.slice('--from='.length).trim();
    } else if ((arg === '--exe' || arg === '--from') && i + 1 < argv.length) {
      prebuiltExe = argv[++i].trim();
    } else if (!arg.startsWith('--') && !actionSet) {
      action = arg.trim().toLowerCase();
      actionSet = true;
    }
  }

  return { action, prebuiltExe, skipRust };
}

function buildTypeScriptDist() {
  console.log('[baileys-backup] Mengompilasi TypeScript (dist/whatsapp_baileys.js)...');
  const tscJs = path.join(ROOT_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tscJs], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    windowsHide: true,
  });
}

async function installPrebuiltBinary(sourceExe, skipRust) {
  await stopWatchdogIfRunning();
  stopLegacyHeavyTsxStandbyProcesses();

  if (!fs.existsSync(path.join(ROOT_DIR, 'dist', 'whatsapp_baileys.js'))) {
    buildTypeScriptDist();
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });
  if (sourceExe) {
    const resolved = path.resolve(sourceExe);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File binary prebuilt tidak ditemukan: ${resolved}`);
    }
    fs.writeFileSync(BIN_EXE, fs.readFileSync(resolved));
    console.log(`[baileys-backup] Binary prebuilt disalin dari: ${resolved}`);
  } else if (!skipRust || !fs.existsSync(BIN_EXE)) {
    throw new Error('Binary prebuilt belum tersedia; kirim --exe <path> atau jalankan build.');
  }

  deployToLocalAppData();
  const sizeKb = (fs.statSync(BIN_EXE).size / 1024).toFixed(1);
  console.log(`[baileys-backup] Binary siap: ${BIN_EXE} (${sizeKb} KB)`);
}

async function buildAll() {
  await stopWatchdogIfRunning();
  stopLegacyHeavyTsxStandbyProcesses();

  buildTypeScriptDist();

  console.log('[baileys-backup] 2/2 Mengompilasi native Rust BaileysBackup.exe (System Tray + Custom Icon + Stats Panel)...');
  execFileSync('cargo', ['build', '--release'], {
    cwd: RUST_DIR,
    stdio: 'inherit',
    windowsHide: true,
  });

  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.copyFileSync(RUST_TARGET_EXE, BIN_EXE);
  deployToLocalAppData();
  const sizeKb = (fs.statSync(BIN_EXE).size / 1024).toFixed(1);
  console.log(`[baileys-backup] Binary siap: ${BIN_EXE} (${sizeKb} KB)`);
}

function registerWindowsStartup() {
  if (process.platform !== 'win32') return;
  // Hapus nama registry lama bila masih ada
  try {
    execFileSync(
      'reg.exe',
      ['delete', REG_RUN_KEY, '/v', LEGACY_REG_VALUE_NAME, '/f'],
      { stdio: 'ignore', windowsHide: true },
    );
  } catch {}

  execFileSync(
    'reg.exe',
    [
      'add',
      REG_RUN_KEY,
      '/v',
      REG_VALUE_NAME,
      '/t',
      'REG_SZ',
      '/d',
      `"${INSTALLED_EXE}" --silent --project-dir "${ROOT_DIR}"`,
      '/f',
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  console.log(`[baileys-backup] Auto-start terdaftar di ${REG_RUN_KEY}\\${REG_VALUE_NAME} (System Tray, 0 kedipan terminal).`);
}

function unregisterWindowsStartup() {
  if (process.platform !== 'win32') return;
  for (const keyName of [REG_VALUE_NAME, LEGACY_REG_VALUE_NAME]) {
    try {
      execFileSync(
        'reg.exe',
        ['delete', REG_RUN_KEY, '/v', keyName, '/f'],
        { stdio: 'pipe', windowsHide: true },
      );
      console.log(`[baileys-backup] Auto-start dihapus: ${REG_RUN_KEY}\\${keyName}.`);
    } catch {}
  }
}

function registerWindowsSearchShortcut() {
  if (process.platform !== 'win32') return;
  const lnkPath = getStartMenuShortcutPath();
  const escapedLnk = lnkPath.replace(/'/g, "''");
  const escapedExe = INSTALLED_EXE.replace(/'/g, "''");
  const escapedCwd = ROOT_DIR.replace(/'/g, "''");
  const iconTarget = fs.existsSync(INSTALLED_EXE) ? INSTALLED_EXE : INSTALLED_ICO;
  const escapedIco = iconTarget.replace(/'/g, "''");

  const psScript = [
    `$wsh = New-Object -ComObject WScript.Shell;`,
    `$sc = $wsh.CreateShortcut('${escapedLnk}');`,
    `$sc.TargetPath = '${escapedExe}';`,
    `$sc.Arguments = '--project-dir "' + '${escapedCwd}' + '"';`,
    `$sc.WorkingDirectory = '${escapedCwd}';`,
    `$sc.IconLocation = '${escapedIco},0';`,
    `$sc.Description = 'Baileys Backup - Standby & Auto-Failover Bot WhatsApp Lokal';`,
    `$sc.WindowStyle = 1;`,
    `$sc.Save();`,
  ].join(' ');

  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { stdio: 'inherit', windowsHide: true },
  );
  flushWindowsShellIconCache();
  console.log(`[baileys-backup] Terdaftar di Windows Search & Start Menu: ${lnkPath}`);
}

function checkWindowsSearchShortcutRegistered() {
  if (process.platform !== 'win32') return false;
  return fs.existsSync(getStartMenuShortcutPath());
}

function checkWindowsStartupRegistered() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'reg.exe',
      ['query', REG_RUN_KEY, '/v', REG_VALUE_NAME],
      { encoding: 'utf8', stdio: 'pipe', windowsHide: true },
    );
    return out.includes(REG_VALUE_NAME);
  } catch {
    return false;
  }
}

function promoteTrayIconVisibility() {
  if (process.platform !== 'win32') return;
  try {
    const psCmd = [
      `$keys = Get-ChildItem 'HKCU:\\Control Panel\\NotifyIconSettings' -ErrorAction SilentlyContinue;`,
      'foreach ($k in $keys) {',
      '  $p = (Get-ItemProperty -Path $k.PSPath -Name ExecutablePath -ErrorAction SilentlyContinue).ExecutablePath;',
      "  if ($p -and ($p -match 'BaileysBackup\\.exe')) {",
      '    Set-ItemProperty -Path $k.PSPath -Name IsPromoted -Value 1 -Type DWord -ErrorAction SilentlyContinue;',
      '  }',
      '}',
    ].join(' ');
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd],
      { stdio: 'ignore', windowsHide: true },
    );
  } catch {}
}

function getProcessRamMb(pid) {
  if (!pid || process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `(Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue).WorkingSet64`,
      ],
      { encoding: 'utf8', stdio: 'pipe', windowsHide: true },
    ).trim();
    const bytes = Number(out);
    return Number.isFinite(bytes) && bytes > 0 ? (bytes / (1024 * 1024)).toFixed(2) : null;
  } catch {
    return null;
  }
}

async function startWatchdog() {
  if (!fs.existsSync(BIN_EXE) || !fs.existsSync(path.join(ROOT_DIR, 'dist', 'whatsapp_baileys.js'))) {
    await buildAll();
  }
  if (process.platform === 'win32' && !fs.existsSync(INSTALLED_EXE)) {
    deployToLocalAppData();
  }
  stopLegacyHeavyTsxStandbyProcesses();

  const existing = await sendControlCommand('STATUS', 1000);
  if (existing) {
    console.log(`[baileys-backup] Baileys Backup sudah berjalan di System Tray (PID ${existing.watchdogPid}).`);
    promoteTrayIconVisibility();
    return;
  }

  if (process.platform === 'win32') {
    const escapedExe = INSTALLED_EXE.replace(/'/g, "''");
    const escapedCwd = ROOT_DIR.replace(/'/g, "''");
    const psLaunch = [
      `$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; WinstationDesktop = 'WinSta0\\Default' };`,
      `$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '"${escapedExe}" --silent --project-dir "${escapedCwd}"'; CurrentDirectory = '${escapedCwd}'; ProcessStartupInformation = $si };`,
      `if ($res.ReturnValue -ne 0) { throw "Win32_Process.Create gagal: ReturnValue=$($res.ReturnValue)" }`,
    ].join(' ');
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psLaunch],
      { stdio: 'ignore', windowsHide: true },
    );
  } else {
    const child = spawn(BIN_EXE, ['--silent', '--project-dir', ROOT_DIR], {
      cwd: ROOT_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }

  for (let i = 0; i < 18; i++) {
    await sleep(300);
    const st = await sendControlCommand('STATUS', 1000);
    if (st && st.trayActive === true && st.vpsState !== 'mengecek...') break;
  }
  promoteTrayIconVisibility();
}

async function printStatus() {
  const st = await sendControlCommand('STATUS', 2000);
  const autoStart = checkWindowsStartupRegistered();
  const inSearch = checkWindowsSearchShortcutRegistered();
  console.log('=== STATUS BAILEYS BACKUP (WINDOWS SYSTEM TRAY & AUTO-FAILOVER) ===');
  console.log(`Nama Aplikasi            : Baileys Backup (${process.platform === 'win32' ? INSTALLED_EXE : BIN_EXE})`);
  console.log(`Ikon & System Tray       : ${st?.trayActive ? 'AKTIF (Muncul di System Tray dekat jam Windows)' : 'BELUM TERDAFTAR / NONAKTIF'}`);
  console.log(`Terdaftar Windows Search : ${inSearch ? `YA (${getStartMenuShortcutPath()})` : 'BELUM'}`);
  console.log(`Auto-Start Login Windows : ${autoStart ? 'AKTIF (HKCU\\...\\Run\\BaileysBackup)' : 'NONAKTIF'}`);
  if (!st) {
    console.log('Status Proses            : TIDAK BERJALAN');
  } else {
    const appPrivMb = typeof st.appPrivateKb === 'number' && st.appPrivateKb > 0
      ? (st.appPrivateKb / 1024).toFixed(2)
      : getProcessRamMb(st.watchdogPid) ?? '~2.0';
    const appWsMb = typeof st.appWorkingKb === 'number' && st.appWorkingKb > 0
      ? (st.appWorkingKb / 1024).toFixed(2)
      : getProcessRamMb(st.watchdogPid) ?? '?';
    const nodeMb = st.childNodePid
      ? (typeof st.nodePrivateKb === 'number' && st.nodePrivateKb > 0
          ? (st.nodePrivateKb / 1024).toFixed(2)
          : getProcessRamMb(st.childNodePid) ?? '?')
      : null;
    console.log(`Status Proses            : BERJALAN (PID ${st.watchdogPid}, Private RAM: ${appPrivMb} MB, WS: ${appWsMb} MB)`);
    console.log(`Status VPS Utama         : ${st.vpsState} (${st.vpsAvailability})`);
    console.log(
      `Mode Backup Lokal        : ${
        st.failoverActive
          ? `BACKUP AKTIF (node.exe PID ${st.childNodePid}, RAM: ${nodeMb ?? '?'} MB)`
          : 'STANDBY PASIF (0 proses Node.js, hemat RAM)'
      }`,
    );
    console.log(`Statistik                : Uptime ${st.uptimeSecs}d | Cek VPS ${st.totalChecks ?? 0}x | Failover ${st.failoverCount ?? 0}x`);
  }
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split(/\r?\n/).slice(-8);
    console.log('\n--- Log Terakhir (logs/wa-standby-watchdog.log) ---');
    for (const l of lines) console.log(l);
  }
}

const { action, prebuiltExe, skipRust } = parseCliArgs(process.argv.slice(2));

if (action === 'build') {
  await buildAll();
} else if (action === 'install') {
  if (prebuiltExe || (skipRust && fs.existsSync(BIN_EXE))) {
    await installPrebuiltBinary(prebuiltExe, skipRust);
  } else {
    await buildAll();
  }
  registerWindowsStartup();
  registerWindowsSearchShortcut();
  await startWatchdog();
  await printStatus();
} else if (action === 'start') {
  await startWatchdog();
  await printStatus();
} else if (action === 'stop') {
  await stopWatchdogIfRunning();
  stopLegacyHeavyTsxStandbyProcesses();
  await printStatus();
} else if (action === 'uninstall') {
  await stopWatchdogIfRunning();
  stopLegacyHeavyTsxStandbyProcesses();
  unregisterWindowsStartup();
  await printStatus();
} else {
  await printStatus();
}
