# Asistente Web Vivo
# Arranca el puente (gateway) hacia el servidor OpenCode del Desktop y expone un túnel público.

$ErrorActionPreference = "Stop"
$AppDir   = $PSScriptRoot
$WebPort  = 4500
$TempLogs = Join-Path $env:TEMP "web-assistant"

New-Item -ItemType Directory -Force -Path $TempLogs | Out-Null

Write-Host ""
Write-Host "== Asistente Web Vivo ==" -ForegroundColor Cyan

# 1) Descubrir el servidor OpenCode del Desktop
$desktopUrl = $env:OPENCODE_DESKTOP_URL
if (-not $desktopUrl) {
  $pids = (Get-Process -Name OpenCode -ErrorAction SilentlyContinue).Id
  $conn = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
          Where-Object { $pids -contains $_.OwningProcess } |
          Select-Object -First 1
  if ($conn) { $desktopUrl = "http://127.0.0.1:$($conn.LocalPort)" }
}
if (-not $desktopUrl) {
  Write-Host "No se encontro el servidor de OpenCode Desktop. Abre la app y vuelve a ejecutar." -ForegroundColor Red
  exit 1
}
Write-Host "Servidor OpenCode Desktop: $desktopUrl"

$uuid = $env:OPENCODE_SERVER_PASSWORD
if (-not $uuid) {
  Write-Host "Falta OPENCODE_SERVER_PASSWORD en el entorno. No puedo autenticarme contra el servidor." -ForegroundColor Red
  exit 1
}
$authHead = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("opencode:$uuid")) }
try {
  $health = Invoke-RestMethod -Uri "$desktopUrl/global/health" -Headers $authHead -TimeoutSec 8
  Write-Host "Health OK: $($health.version)"
} catch {
  Write-Host "El servidor del Desktop no responde: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

# 2) Contraseña del chat (no se guarda en disco)
$webPass = $env:OPENCODE_WEB_PASSWORD
if (-not $webPass) {
  $sec = Read-Host "Contrasena del chat (la que pone el usuario en Ajustes)" -AsSecureString
  $webPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  )
}

# 3) Lanzar el gateway
$gwLog  = Join-Path $TempLogs "gateway.out.log"
$gwErr  = Join-Path $TempLogs "gateway.err.log"
$env:WEB_PASSWORD  = $webPass
$env:DESKTOP_URL   = $desktopUrl
$env:DESKTOP_PASSWORD = $uuid
$env:DIRECTORY     = $AppDir
$env:WEB_PORT      = "$WebPort"

$gw = Start-Process -FilePath "node" -ArgumentList "`"$AppDir\server\gateway.js`"" -WindowStyle Hidden `
      -RedirectStandardOutput $gwLog -RedirectStandardError $gwErr -PassThru
Write-Host "Gateway PID $($gw.Id) -> http://127.0.0.1:$WebPort"

$webAuthHead = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("opencode:$webPass")) }

# Esperar a que el gateway responda
$gwReady = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$WebPort/global/health" -Headers $webAuthHead -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $gwReady = $true; break }
  } catch {}
}
if (-not $gwReady) {
  Write-Host "El gateway no arranco. Revisa: $gwErr" -ForegroundColor Red
  Stop-Process -Id $gw.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "Gateway conectado y autenticado." -ForegroundColor Green

# 4) Túnel público con cloudflared (portable, en la carpeta del proyecto)
$cf   = Join-Path $AppDir "cloudflared.exe"
$cfOut = Join-Path $TempLogs "cloudflared.out.log"
$cfErr = Join-Path $TempLogs "cloudflared.err.log"
$tunnelUrl = ""

if (Test-Path $cf) {
  $cfp = Start-Process -FilePath $cf -ArgumentList "tunnel","--url","http://127.0.0.1:$WebPort" `
          -WindowStyle Hidden -RedirectStandardOutput $cfOut -RedirectStandardError $cfErr -PassThru
  Write-Host "Cloudflared PID $($cfp.Id) - esperando URL..."
  for ($i = 0; $i -lt 40 -and -not $tunnelUrl; $i++) {
    Start-Sleep -Milliseconds 750
    if (Test-Path $cfOut) {
      $content = Get-Content $cfOut -Raw -ErrorAction SilentlyContinue
      if ($content) { $m = [regex]::Match($content, "https://[a-zA-Z0-9-]+\.trycloudflare\.com"); if ($m.Success) { $tunnelUrl = $m.Value } }
    }
    if (Test-Path $cfErr) {
      $contentE = Get-Content $cfErr -Raw -ErrorAction SilentlyContinue
      if ($contentE) { $m2 = [regex]::Match($contentE, "https://[a-zA-Z0-9-]+\.trycloudflare\.com"); if ($m2.Success) { $tunnelUrl = $m2.Value } }
    }
  }
  if ($tunnelUrl) {
    Write-Host "Tunel publico: $tunnelUrl" -ForegroundColor Green
  } else {
    Write-Host "No se pudo leer la URL del tunel de cloudflared. Revisa: $cfErr" -ForegroundColor Yellow
  }
} else {
  Write-Host "No esta cloudflared.exe en la carpeta del proyecto. Sin tunel publico." -ForegroundColor Yellow
}

# 5) Instrucciones
Write-Host ""
Write-Host "Web publica:       https://desarrolladormadrid2.github.io/asistente-web-demo/" -ForegroundColor Cyan
if ($tunnelUrl) {
  Write-Host "URL del chat (Ajustes del widget o chat-config.json): $tunnelUrl" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "Pulsa Enter para detener el asistente (gateway + tunel)..."

$null = Read-Host
if ($cfp) { Stop-Process -Id $cfp.Id -Force -ErrorAction SilentlyContinue }
Stop-Process -Id $gw.Id -Force -ErrorAction SilentlyContinue
Write-Host "Asistente detenido."