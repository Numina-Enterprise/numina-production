$ErrorActionPreference='Stop'
$cf='C:\Program Files (x86)\cloudflared\cloudflared.exe'
$root='C:\ProgramData\Numina'
New-Item -ItemType Directory -Force -Path $root | Out-Null
Copy-Item 'C:\Users\sam\.cloudflared\start-numina-system-origin.ps1' (Join-Path $root 'start-origin.ps1') -Force
Copy-Item 'C:\Users\sam\.cloudflared\watch-numina-system.ps1' (Join-Path $root 'watch-system.ps1') -Force
icacls $root /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'Users:(OI)(CI)RX' | Out-Null

$token=(& $cf tunnel --origincert 'C:\Users\sam\.cloudflared\cert.pem' token numina-layer7 2>$null).Trim()
if(-not $token){throw 'Unable to retrieve tunnel token'}
if(-not (Get-Service cloudflared -ErrorAction SilentlyContinue)){& $cf service install $token | Out-Null}
Remove-Variable token
$svcPath='HKLM:\SYSTEM\CurrentControlSet\Services\cloudflared'
New-ItemProperty -Path $svcPath -Name Environment -PropertyType MultiString -Value @('TUNNEL_URL=http://localhost:8000','NO_AUTOUPDATE=true') -Force | Out-Null
sc.exe config cloudflared start= delayed-auto | Out-Null

schtasks.exe /Create /TN 'NuminaOriginBoot' /TR 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\ProgramData\Numina\start-origin.ps1"' /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
schtasks.exe /Create /TN 'NuminaSystemWatchdog' /TR 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\ProgramData\Numina\watch-system.ps1"' /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F | Out-Null
& 'C:\ProgramData\Numina\start-origin.ps1'
Restart-Service cloudflared -Force
Start-Sleep -Seconds 6
schtasks.exe /Run /TN 'NuminaSystemWatchdog' | Out-Null
$svc=Get-CimInstance Win32_Service -Filter "Name='cloudflared'"
@(
  'ADMIN=True',
  ('SERVICE_STATE='+$svc.State),
  ('SERVICE_STARTMODE='+$svc.StartMode),
  ('SERVICE_PATH='+$svc.PathName),
  ('ORIGIN_BOOT_TASK='+[bool](schtasks.exe /Query /TN 'NuminaOriginBoot' 2>$null)),
  ('WATCHDOG_TASK='+[bool](schtasks.exe /Query /TN 'NuminaSystemWatchdog' 2>$null))
) | Set-Content (Join-Path $root 'elevated-setup-status.txt')
