# Inicia el cluster PostgreSQL local de MARFYL (puerto 5434).
$dataDir = Join-Path $env:USERPROFILE 'marfyl-pgdata'
$pgCtl = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'

if (-not (Test-Path $dataDir)) {
  Write-Error "No existe $dataDir. Ejecute primero: initdb -D `"$dataDir`" -U marfyl_user -A trust -E UTF8"
  exit 1
}

& $pgCtl -D $dataDir -o '-p 5434' -l (Join-Path $dataDir 'server.log') status 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host 'PostgreSQL MARFYL ya está corriendo en 127.0.0.1:5434'
  exit 0
}

& $pgCtl -D $dataDir -o '-p 5434' -l (Join-Path $dataDir 'server.log') start
if ($LASTEXITCODE -eq 0) {
  Write-Host 'PostgreSQL MARFYL iniciado en 127.0.0.1:5434'
} else {
  Write-Error 'No se pudo iniciar PostgreSQL MARFYL'
  exit 1
}
