param(
    [string]$ProjectDir = ''
)

$ErrorActionPreference = 'Stop'

function Test-ValidProjectRoot {
    param([string]$Candidate)
    if ([string]::IsNullOrWhiteSpace($Candidate)) { return $false }
    if (-not (Test-Path -LiteralPath $Candidate -PathType Container)) { return $false }
    return (Test-Path -LiteralPath (Join-Path $Candidate 'package.json') -PathType Leaf) -and
           (Test-Path -LiteralPath (Join-Path $Candidate '.env') -PathType Leaf)
}

function Resolve-ProjectRoot {
    param([string]$ExplicitDir)

    if (-not [string]::IsNullOrWhiteSpace($ExplicitDir)) {
        $resolved = (Resolve-Path -LiteralPath $ExplicitDir -ErrorAction SilentlyContinue).Path
        if (Test-ValidProjectRoot $resolved) { return $resolved }
        throw "Folder proyek tidak valid (harus berisi package.json dan .env): $ExplicitDir"
    }

    try {
        $regVal = (Get-ItemProperty -Path 'HKCU:\Software\BaileysBackup' -Name 'ProjectRoot' -ErrorAction SilentlyContinue).ProjectRoot
        if (Test-ValidProjectRoot $regVal) { return $regVal }
    } catch {}

    $cur = $PSScriptRoot
    for ($i = 0; $i -lt 6; $i++) {
        if (Test-ValidProjectRoot $cur) { return $cur }
        $parent = Split-Path -Path $cur -Parent
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cur) { break }
        $cur = $parent
    }

    $cur = (Get-Location).Path
    for ($i = 0; $i -lt 5; $i++) {
        if (Test-ValidProjectRoot $cur) { return $cur }
        $parent = Split-Path -Path $cur -Parent
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cur) { break }
        $cur = $parent
    }

    while ($true) {
        $inputDir = Read-Host 'Masukkan path folder proyek FreeAIBot (contoh: D:\code\project\projek_no_name)'
        $inputDir = $inputDir.Trim().Trim('"')
        if (Test-ValidProjectRoot $inputDir) {
            return (Resolve-Path -LiteralPath $inputDir).Path
        }
        Write-Host '[!] Folder tidak valid: pastikan berisi file package.json dan .env.' -ForegroundColor Yellow
    }
}

function Send-ControlCommand {
    param(
        [string]$Command,
        [int]$TimeoutMs = 2000
    )
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $ar = $client.BeginConnect('127.0.0.1', 47831, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            $client.Close()
            return $null
        }
        $client.EndConnect($ar)
        $client.ReceiveTimeout = $TimeoutMs
        $client.SendTimeout = $TimeoutMs
        $stream = $client.GetStream()
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("$Command`n")
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $line = $reader.ReadLine()
        $client.Close()
        return $line
    } catch {
        return $null
    }
}

function Stop-RunningBaileysBackup {
    $st = Send-ControlCommand -Command 'STATUS' -TimeoutMs 1200
    if ($st) {
        Write-Host '[baileys-backup] Menghentikan instance Baileys Backup yang sedang aktif...'
        $null = Send-ControlCommand -Command 'STOP' -TimeoutMs 2500
        for ($i = 0; $i -lt 16; $i++) {
            Start-Sleep -Milliseconds 250
            if (-not (Get-Process -Name 'BaileysBackup' -ErrorAction SilentlyContinue)) { break }
        }
    }
    Get-Process -Name 'BaileysBackup' -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 200
}

function Update-ShellIconCache {
    try {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BaileysShellSync {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
'@ -ErrorAction SilentlyContinue
        [BaileysShellSync]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
    } catch {}
}

$sourceExe = Join-Path $PSScriptRoot 'BaileysBackup.exe'
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    $repoBinExe = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\bin\BaileysBackup.exe'))
    if (Test-Path -LiteralPath $repoBinExe -PathType Leaf) {
        $sourceExe = $repoBinExe
    } else {
        throw "BaileysBackup.exe tidak ditemukan di sebelah skrip ($PSScriptRoot)."
    }
}

$projectRoot = Resolve-ProjectRoot -ExplicitDir $ProjectDir
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\BaileysBackup'
$installedExe = Join-Path $installDir 'BaileysBackup.exe'

Stop-RunningBaileysBackup

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
[System.IO.File]::WriteAllBytes($installedExe, [System.IO.File]::ReadAllBytes($sourceExe))

foreach ($icoName in @('baileys-backup.ico', 'baileys-backup-active.ico')) {
    $srcIco = Join-Path $PSScriptRoot $icoName
    if (-not (Test-Path -LiteralPath $srcIco -PathType Leaf)) {
        $fallbackIco = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\bin\$icoName"))
        if (Test-Path -LiteralPath $fallbackIco -PathType Leaf) {
            $srcIco = $fallbackIco
        } else {
            $srcIco = $null
        }
    }
    if ($srcIco) {
        [System.IO.File]::WriteAllBytes((Join-Path $installDir $icoName), [System.IO.File]::ReadAllBytes($srcIco))
    }
}

New-Item -Path 'HKCU:\Software\BaileysBackup' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\BaileysBackup' -Name 'ProjectRoot' -Value $projectRoot -Type String

$runKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -Path $runKeyPath -Force | Out-Null
Remove-ItemProperty -Path $runKeyPath -Name 'FreeAIBotStandbyWatchdog' -ErrorAction SilentlyContinue
Set-ItemProperty -Path $runKeyPath -Name 'BaileysBackup' -Value "`"$installedExe`" --silent --project-dir `"$projectRoot`"" -Type String

$lnkPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Baileys Backup.lnk'
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($lnkPath)
$sc.TargetPath = $installedExe
$sc.Arguments = "--project-dir `"$projectRoot`""
$sc.WorkingDirectory = $projectRoot
$sc.IconLocation = "$installedExe,0"
$sc.Description = 'Baileys Backup - Standby & Auto-Failover Bot WhatsApp Lokal'
$sc.WindowStyle = 1
$sc.Save()

Update-ShellIconCache

Start-Process -FilePath $installedExe -ArgumentList @('--silent', '--project-dir', $projectRoot) -WorkingDirectory $projectRoot

for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Milliseconds 300
    $rawSt = Send-ControlCommand -Command 'STATUS' -TimeoutMs 1000
    if ($rawSt) { break }
}

Get-ChildItem 'HKCU:\Control Panel\NotifyIconSettings' -ErrorAction SilentlyContinue | ForEach-Object {
    $ep = (Get-ItemProperty -Path $_.PSPath -Name 'ExecutablePath' -ErrorAction SilentlyContinue).ExecutablePath
    if ($ep -and ($ep -match 'BaileysBackup\.exe')) {
        Set-ItemProperty -Path $_.PSPath -Name 'IsPromoted' -Value 1 -Type DWord -ErrorAction SilentlyContinue
    }
}

$proc = Get-Process -Name 'BaileysBackup' -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Host ''
Write-Host '=== BAILEYS BACKUP TERPASANG ===' -ForegroundColor Green
Write-Host ("Binary Terpasang : {0}" -f $installedExe)
Write-Host ("Folder Proyek    : {0}" -f $projectRoot)
Write-Host ("Auto-Start Login : Aktif ({0}\BaileysBackup)" -f $runKeyPath)
Write-Host ("Start Menu       : {0}" -f $lnkPath)
if ($proc) {
    Write-Host ("Status Proses    : BERJALAN (PID {0})" -f $proc.Id)
} else {
    Write-Host 'Status Proses    : Belum terdeteksi (buka lewat Start Menu "Baileys Backup")'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\whatsapp_baileys.js') -PathType Leaf)) {
    Write-Host '[!] Catatan: dist/whatsapp_baileys.js belum ada di folder proyek. Jalankan `npm run build` agar failover lokal bisa menyala.' -ForegroundColor Yellow
}
Write-Host 'Klik ikon Baileys Backup di System Tray (dekat jam Windows) untuk membuka Panel Statistik & tombol Resume VPS.'
