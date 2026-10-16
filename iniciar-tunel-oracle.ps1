#Requires -Version 5.1
<#
.SYNOPSIS
  Abre el túnel SSH hacia PostgreSQL en Oracle Cloud.

.DESCRIPTION
  Arquitectura: API local -> 127.0.0.1:15432 -> túnel SSH -> PostgreSQL en Oracle (127.0.0.1:5432).
  Antes de abrir el túnel verifica: ejecutable SSH, clave privada, que no haya
  otro túnel nuestro corriendo, que el puerto local 15432 esté libre y que haya
  conectividad SSH con el servidor. No contiene ni pide la contraseña de
  PostgreSQL (esa vive en api/config.local.php, fuera de git).

.USO
  .\iniciar-tunel-oracle.ps1
  .\cerrar-tunel-oracle.ps1   # para cerrarlo
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$SshExe       = 'C:\msys64\usr\bin\ssh.exe'
$KeyPath      = Join-Path $env:USERPROFILE 'Downloads\ssh-key-2026-10-13.key'
$SshUser      = 'ubuntu'
$SshHost      = '155.181.131.152'
$LocalPort    = 15432
$RemoteTarget = '127.0.0.1:5432'
$PidFile      = Join-Path $PSScriptRoot '.tunel-oracle.pid'

function Test-PortListen([int]$Port) {
    $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# 1) Ejecutable SSH -----------------------------------------------------------
if (-not (Test-Path -LiteralPath $SshExe)) {
    Write-Error "No existe el ejecutable SSH: $SshExe"
}

# 2) Clave privada -------------------------------------------------------------
if (-not (Test-Path -LiteralPath $KeyPath)) {
    Write-Error "No existe la clave privada: $KeyPath"
}

# 3) ¿Ya hay un túnel nuestro corriendo? ---------------------------------------
if (Test-Path -LiteralPath $PidFile) {
    $oldPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
    if ($null -ne $proc -and $proc.ProcessName -match '^ssh$') {
        Write-Host "El túnel ya está corriendo (PID $oldPid). Nada que hacer."
        exit 0
    }
    # PID rancio: el proceso ya no existe.
    Remove-Item -LiteralPath $PidFile -Force
}

# 4) Puerto local libre ---------------------------------------------------------
if (Test-PortListen $LocalPort) {
    Write-Error "El puerto $LocalPort ya está en uso por otro proceso. No se inicia el túnel."
}

# 5) Conectividad SSH (sin abrir túnel, autenticación por clave, sin prompts) ---
& $SshExe -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new `
    -i $KeyPath "$SshUser@$SshHost" 'echo SSH_OK' | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Sin conectividad SSH con $SshUser@$SshHost (código $LASTEXITCODE)."
}
Write-Host 'Conectividad SSH OK.'

# 6) Abrir el túnel en segundo plano --------------------------------------------
$sshArgs = @(
    '-N',
    '-L', "$LocalPort`:$RemoteTarget",
    '-i', $KeyPath,
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    "$SshUser@$SshHost"
)
$tunnel = Start-Process -FilePath $SshExe -ArgumentList $sshArgs `
    -PassThru -WindowStyle Hidden
$tunnel.Id | Set-Content -LiteralPath $PidFile -NoNewline

# 7) Esperar a que el puerto local escuche (máx. 10 s) --------------------------
$ok = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    if ($tunnel.HasExited) { break }
    if (Test-PortListen $LocalPort) { $ok = $true; break }
}

if (-not $ok) {
    if (-not $tunnel.HasExited) {
        Stop-Process -Id $tunnel.Id -Force
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Error "El túnel no llegó a escuchar en 127.0.0.1:$LocalPort. Revisá la salida de ssh."
}

Write-Host "Túnel abierto: 127.0.0.1:$LocalPort -> $SshHost ($RemoteTarget), PID $($tunnel.Id)."
Write-Host 'Para cerrarlo: .\cerrar-tunel-oracle.ps1'
