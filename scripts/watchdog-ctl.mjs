/**
 * Pengelola Watchdog Native Rust (`bin/wa-standby-watchdog.exe`) untuk Windows:
 * - `node scripts/watchdog-ctl.mjs build`     : Kompilasi TypeScript (`dist/`) + binary Rust (`bin/wa-standby-watchdog.exe`)
 * - `node scripts/watchdog-ctl.mjs install`   : Build, hentikan proses tsx berat lama, daftarkan auto-start Windows (HKCU\...\Run), & jalankan watchdog tanpa jendela terminal
 * - `node scripts/watchdog-ctl.mjs start`     : Jalankan watchdog di latar belakang tanpa jendela terminal
 * - `node scripts/watchdog-ctl.mjs status`    : Tampilkan status live watchdog, status VPS, pemakaian RAM (MB), status auto-start, & log terakhir
 * - `node scripts/watchdog-ctl.mjs stop`      : Hentikan watchdog (dan sync sesi bila backup lokal sedang aktif)
 * - `node scripts/watchdog-ctl.mjs uninstall` : Hentikan watchdog & hapus pendaftaran auto-start Windows
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const RUST_DIR = path.join(ROOT_DIR, 'tools', 'wa-standby-watchdog');
const RUST_TARGET_EXE = path.join(RUST_DIR, 'target', 'release', 'wa-standby-watchdog.exe');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const BIN_EXE = path.join(BIN_DIR, 'wa-standby-watchdog.exe');
const LOG_FILE = path.join(ROOT_DIR, 'logs', 'wa-standby-watchdog.log');
const CONTROL_PORT = 47831;
const CONTROL_HOST = '127.0.0.1';
const REG_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_VALUE_NAME = 'FreeAIBotStandbyWatchdog';

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
    console.log(`[watchdog-ctl] Menghentikan watchdog aktif (PID ${status.watchdogPid})...`);
    await sendControlCommand('STOP', 5000);
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      const again = await sendControlCommand('STATUS', 600);
      if (!again) break;
    }
  }
}

function stopLegacyHeavyTsxStandbyProcesses() {
  if (process.platform !== 'win32') return;
  try {
    const psScript = [
      "$procs = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -match 'whatsapp_baileys.*--standby|npm-cli\\.js.*whatsapp:standby' };",
      'foreach ($p in $procs) {',
      '  Write-Output ("Stopping legacy heavy standby node PID " + $p.ProcessId);',
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

async function buildAll() {
  await stopWatchdogIfRunning();

  console.log('[watchdog-ctl] 1/2 Mengompilasi TypeScript (dist/whatsapp_baileys.js)...');
  const tscJs = path.join(ROOT_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tscJs], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    windowsHide: true,
  });

  console.log('[watchdog-ctl] 2/2 Mengompilasi native Rust watchdog (release, size-optimized, windowless)...');
  execFileSync('cargo', ['build', '--release'], {
    cwd: RUST_DIR,
    stdio: 'inherit',
    windowsHide: true,
  });

  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.copyFileSync(RUST_TARGET_EXE, BIN_EXE);
  const sizeKb = (fs.statSync(BIN_EXE).size / 1024).toFixed(1);
  console.log(`[watchdog-ctl] Binary siap: ${BIN_EXE} (${sizeKb} KB)`);
}

function registerWindowsStartup() {
  if (process.platform !== 'win32') return;
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
      `"${BIN_EXE}"`,
      '/f',
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  console.log(`[watchdog-ctl] Auto-start terdaftar di ${REG_RUN_KEY}\\${REG_VALUE_NAME} (tanpa jendela terminal).`);
}

function unregisterWindowsStartup() {
  if (process.platform !== 'win32') return;
  try {
    execFileSync(
      'reg.exe',
      ['delete', REG_RUN_KEY, '/v', REG_VALUE_NAME, '/f'],
      { stdio: 'pipe', windowsHide: true },
    );
    console.log(`[watchdog-ctl] Auto-start dihapus dari ${REG_RUN_KEY}\\${REG_VALUE_NAME}.`);
  } catch {
    console.log('[watchdog-ctl] Entry auto-start sudah tidak ada di Registry.');
  }
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
  stopLegacyHeavyTsxStandbyProcesses();

  const existing = await sendControlCommand('STATUS', 1000);
  if (existing) {
    console.log(`[watchdog-ctl] Watchdog sudah berjalan (PID ${existing.watchdogPid}).`);
    return;
  }

  const child = spawn(BIN_EXE, [], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 15; i++) {
    await sleep(300);
    const st = await sendControlCommand('STATUS', 1000);
    if (st && st.vpsState !== 'init') break;
  }
}

async function printStatus() {
  const st = await sendControlCommand('STATUS', 2000);
  const autoStart = checkWindowsStartupRegistered();
  console.log('=== STATUS WATCHDOG BACKUP WHATSAPP (RUST NATIVE) ===');
  console.log(`Auto-Start Login Windows : ${autoStart ? 'AKTIF (Tanpa Jendela / 0 Kedipan Terminal)' : 'NONAKTIF'}`);
  if (!st) {
    console.log('Status Proses Watchdog   : TIDAK BERJALAN');
  } else {
    const wdRam = getProcessRamMb(st.watchdogPid);
    const nodeRam = st.childNodePid ? getProcessRamMb(st.childNodePid) : null;
    console.log(`Status Proses Watchdog   : BERJALAN (PID ${st.watchdogPid}, RAM: ${wdRam ?? '~2.0'} MB)`);
    console.log(`Status VPS Utama         : ${st.vpsState} (${st.vpsAvailability})`);
    console.log(
      `Mode Backup Lokal        : ${
        st.failoverActive
          ? `BACKUP AKTIF (node.exe PID ${st.childNodePid}, RAM: ${nodeRam ?? '?'} MB)`
          : 'STANDBY PASIF (0 proses Node.js, hemat RAM)'
      }`,
    );
    console.log(`Uptime Watchdog          : ${st.uptimeSecs} detik`);
  }
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split(/\r?\n/).slice(-8);
    console.log('\n--- Log Terakhir (logs/wa-standby-watchdog.log) ---');
    for (const l of lines) console.log(l);
  }
}

const action = (process.argv[2] || 'status').trim().toLowerCase();

if (action === 'build') {
  await buildAll();
} else if (action === 'install') {
  await buildAll();
  registerWindowsStartup();
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
