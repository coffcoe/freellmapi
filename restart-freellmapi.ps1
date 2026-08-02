# FreeLLMAPI canonical restart script (2026-08-02 final)
# Root cause lesson: never start node with an in-session background pipe. If nobody
#   consumes stdout, the pipe buffer fills -> node blocks on synchronous write ->
#   event loop freezes -> all POST time out (symptom: "restart did nothing").
# Correct way: Start-Process directly launches node.exe (absolute path) detached from
#   the session, with stdout/stderr redirected to log files.
#
# Methods confirmed UNUSABLE in this sandbox/host:
#   - Start-Process -UseNewEnvironment  -> fails in this environment
#   - cmd.exe / cmd /c start chain       -> blocked by host security layer
# So startup always uses Start-Process node.exe directly (inherits current env).
#
# Design: all progress/errors are appended to server/logs/restart-debug.log so we do
#   not depend on stdout being echoed back.
# NOTE: keep this file pure ASCII. Chinese rationale lives in CUSTOM-PATCHES.md.

$ErrorActionPreference = "Stop"
$root   = "C:\Users\coffcoe\freellmapi"
$node   = "C:\Users\coffcoe\.workbuddy\binaries\node\versions\22.22.2\node.exe"
$logDir = Join-Path $root "server\logs"
$debug  = Join-Path $logDir "restart-debug.log"

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    try { Add-Content -Path $debug -Value $line -ErrorAction SilentlyContinue } catch {}
}

try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    Log "=== restart-freellmapi.ps1 start ==="
    Log "node=$node  exists=$((Test-Path $node))"
    Log "root=$root  exists=$((Test-Path $root))"

    # 1. kill existing 3001 listener
    $conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Log "step1: kill old PID $($conn.OwningProcess)"
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep 2
    } else {
        Log "step1: no 3001 listener, skip"
    }

    # 2. clean logs older than 7 days
    Get-ChildItem $logDir -Filter "freellmapi-*.log" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force
    Log "step2: old logs cleaned"

    # 3. start detached + redirect logs
    $ts     = Get-Date -Format "yyyyMMdd-HHmmss"
    $outLog = Join-Path $logDir "freellmapi-$ts.out.log"
    $errLog = Join-Path $logDir "freellmapi-$ts.err.log"
    Log "step3: launch node -> out=$outLog err=$errLog"
    $proc = Start-Process -FilePath $node -ArgumentList "server/dist/index.js" -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
    Log "step3: Start-Process returned PID=$($proc.Id) HasExited=$($proc.HasExited)"

    # 4. health check
    Start-Sleep 5
    $pid2 = (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    if (-not $pid2) {
        Log "step4 FAIL: 3001 not listening, see $errLog"
        throw "start failed: 3001 not listening"
    }
    Log "step4 OK: FreeLLMAPI started PID=$pid2"
    Log "outLog=$outLog  errLog=$errLog"
    Log "VERIFY POST: curl -s -X POST http://localhost:3001/v1/chat/completions (GET may pass even when frozen; always test POST)"
} catch {
    Log "FATAL: $($_.Exception.Message)"
    Log "STACK: $($_.ScriptStackTrace)"
    Write-Error "restart-freellmapi failed, see $debug"
    exit 1
}

