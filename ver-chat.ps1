# Ver Chat en vivo
# Muestra en la terminal, en tiempo real, las preguntas, respuestas y acciones del asistente.
# Sin dependencias. Basta con que OpenCode Desktop este abierto (y opcionalmente el tunel activo).

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$desktopUrl = $env:OPENCODE_DESKTOP_URL
if (-not $desktopUrl) {
  $pids = (Get-Process -Name OpenCode -ErrorAction SilentlyContinue).Id
  $conn = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
          Where-Object { $pids -contains $_.OwningProcess } | Select-Object -First 1
  if ($conn) { $desktopUrl = "http://127.0.0.1:$($conn.LocalPort)" }
}

$uuid = $env:OPENCODE_SERVER_PASSWORD
if (-not $uuid) { $uuid = [Environment]::GetEnvironmentVariable("OPENCODE_SERVER_PASSWORD", "User") }

if (-not $desktopUrl -or -not $uuid) {
  Write-Host "No hay servidor OpenCode o credenciales. Abre OpenCode Desktop y vuelve a ejecutar." -ForegroundColor Red
  exit 1
}

$h = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("opencode:$uuid")) }

$seen = @{}
$sessionTags = @{}
$startTime = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

function ShortTag($s) {
  if ($null -eq $s -or -not $s.id) { return "" }
  return $s.id.Substring(4, 6)
}

function ToolSummary($p) {
  $name = $p.tool
  $in = $p.state.input
  $line = $name
  if ($in -is [string]) { $line += " $in" }
  elseif ($in) {
    if ($in.title) { $line += " / $($in.title)" }
    if ($in.command) { $line += " / $($in.command)" }
    if ($in.filePath) { $line += " / $($in.filePath)" }
    if ($in.path) { $line += " / $($in.path)" }
    if ($in.owner -and $in.repo) { $line += " / $($in.owner)/$($in.repo)" }
  }
  if ($p.state.status -eq "error") { $line += "  [ERROR $($p.state.error)]" }
  if ($line.Length -gt 160) { $line = $line.Substring(0, 157) + "..." }
  return $line
}

function Show-Message($sid, $m) {
  $tag = $sessionTags[$sid]
  $t = [DateTimeOffset]::FromUnixTimeMilliseconds($m.info.time.created).LocalDateTime.ToString("HH:mm:ss")
  $role = $m.info.role
  if ($role -eq "user") {
    foreach ($p in $m.parts) {
      if ($p.type -eq "text" -and $p.text) {
        Write-Host ("[{0}] {1} {2}" -f $t, $tag, $p.text) -ForegroundColor Green
      }
    }
  }
  elseif ($role -eq "assistant") {
    foreach ($p in $m.parts) {
      if ($p.type -eq "text" -and $p.text) {
        Write-Host ("[{0}] {1}  ->  {2}" -f $t, $tag, $p.text) -ForegroundColor Cyan
      }
      elseif ($p.type -eq "tool") {
        Write-Host ("[{0}] {1}      (accion) {2}" -f $t, $tag, (ToolSummary $p)) -ForegroundColor DarkYellow
      }
      elseif ($p.type -eq "error") {
        Write-Host ("[{0}] {1}      ERROR: {2}" -f $t, $tag, $p.text) -ForegroundColor Red
      }
    }
  }
}

Write-Host ""
Write-Host "== Monitor del chat en vivo ==" -ForegroundColor Magenta
Write-Host ("Servidor: $desktopUrl  (pulsa Ctrl+C para salir)")
Write-Host ""

try {
  while ($true) {
    $sessions = @()
    try {
      $rr = Invoke-RestMethod -Method GET -Uri "$desktopUrl/session?limit=100" -Headers $h -TimeoutSec 10
      if ($rr) {
        $hasItems = $rr.PSObject.Properties.Name -contains "items"
        if ($hasItems -and $rr.items) { $sessions = @($rr.items) }
        elseif ($rr -is [System.Array]) { $sessions = $rr }
        else { $sessions = @() }
      }
    } catch { Start-Sleep -Milliseconds 2000; continue }

    foreach ($s in $sessions) {
      if ($null -eq $s -or -not $s.id) { continue }
      $sid = [string]$s.id
      if (-not $sessionTags.ContainsKey($sid)) {
        $st = [DateTimeOffset]::FromUnixTimeMilliseconds($s.time.created).LocalDateTime.ToString("HH:mm")
        $dir = $s.directory
        $short = ""
        if ($dir) { $short = $dir.Substring($dir.LastIndexOf('\') + 1) }
        Write-Host ("== conversacion: {0}  ({1})  dir> {2}  desde {3} ==" -f $s.title, $sid, $short, $st) -ForegroundColor White
        $sessionTags[$sid] = "[" + (ShortTag $s) + "]"
      }
      try {
        $msgs = @()
        $mm = Invoke-RestMethod -Method GET -Uri "$desktopUrl/session/$sid/message?limit=30" -Headers $h -TimeoutSec 10
        if ($mm) {
          if ($mm -is [System.Array]) { $msgs = $mm } else { $msgs = @($mm) }
        }
        foreach ($m in $msgs) {
          $mid = [string]$m.info.id
          if ($seen.ContainsKey($mid)) { continue }
          $seen[$mid] = $true
          $created = $m.info.time.created
          if ($created -lt $startTime -and $m.info.time.completed) { continue }
          Show-Message $sid $m
        }
      } catch { }
    }
    Start-Sleep -Milliseconds 1500
  }
} finally {
  Write-Host ""
  Write-Host "Monitor detenido."
}