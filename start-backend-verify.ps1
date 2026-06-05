$ErrorActionPreference = "Continue"
Set-Location -LiteralPath "C:\Users\glong\Desktop\Marfyl-project\marfyl-backend"
$logPath = "C:\Users\glong\Desktop\Marfyl-project\marfyl-backend\tfixrouting-backend.log"
# Try to release the file lock
Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
  if ($cmd -and ($cmd -like "*marfyl-backend*" -or $cmd -like "*nest start*")) {
    Write-Output "Killing node PID $($_.Id)"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 1
if (Test-Path -LiteralPath $logPath) {
  try { Remove-Item -LiteralPath $logPath -Force -ErrorAction Stop } catch { Write-Output "Cannot remove log: $_" }
}
# Launch pnpm dev as a background job
$job = Start-Job -ScriptBlock {
  Set-Location -LiteralPath "C:\Users\glong\Desktop\Marfyl-project\marfyl-backend"
  $env:FORCE_COLOR = "0"
  pnpm dev 2>&1
} -Name "marfyl-backend-dev"
Write-Output "JOB_ID=$($job.Id)"
# Persist job id for later retrieval
$job.Id | Out-File -FilePath "C:\Users\glong\Desktop\Marfyl-project\marfyl-backend\.backend-job-id" -Encoding ascii
Start-Sleep -Seconds 2
Get-Job -Id $job.Id -ErrorAction SilentlyContinue | Select-Object Id,Name,State
