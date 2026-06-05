$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'pnpm dev' -WorkingDirectory 'C:\Users\glong\Desktop\Marfyl-project\marfyl-backend' -RedirectStandardOutput 'C:\Users\glong\Desktop\Marfyl-project\marfyl-backend\backend-stdout.log' -RedirectStandardError 'C:\Users\glong\Desktop\Marfyl-project\marfyl-backend\backend-stderr.log' -NoNewWindow -PassThru
Write-Host "PID=$($p.Id)"
