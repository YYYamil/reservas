#Requires -Version 5.1
<#
.SYNOPSIS
  Cierra el túnel SSH abierto con iniciar-tunel-oracle.ps1.

.DESCRIPTION
  Lee el PID guardado en .tunel-oracle.pid y detiene ÚNICAMENTE ese proceso
  (verificando que sea ssh.exe). No cierra ningún otro proceso ni conexión.

.USO
  .\cerrar-tunel-oracle.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$PidFile = Join-Path $PSScriptRoot '.tunel-oracle.pid'

if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Host 'No hay túnel registrado (.tunel-oracle.pid no existe). Nada que cerrar.'
    exit 0
}

$pidGuardado = (Get-Content -LiteralPath $PidFile -Raw).Trim()
$proc = Get-Process -Id $pidGuardado -ErrorAction SilentlyContinue

if ($null -eq $proc) {
    Write-Host "El proceso $pidGuardado ya no existe. Se limpia el registro."
    Remove-Item -LiteralPath $PidFile -Force
    exit 0
}

if ($proc.ProcessName -notmatch '^ssh$') {
    Write-Error ("El PID $pidGuardado ya no es ssh.exe (es '{0}'). " -f $proc.ProcessName +
        'Por seguridad no se detiene. Borrá .tunel-oracle.pid a mano si corresponde.')
}

Stop-Process -Id $proc.Id
Remove-Item -LiteralPath $PidFile -Force
Write-Host "Túnel cerrado (PID $($proc.Id))."
