$ErrorActionPreference='Stop'
sc.exe failure cloudflared reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
sc.exe failureflag cloudflared 1 | Out-Null
sc.exe config cloudflared start= delayed-auto | Out-Null
schtasks.exe /Run /TN 'NuminaSystemWatchdog' | Out-Null
Start-Sleep -Seconds 3
$svc=Get-CimInstance Win32_Service -Filter "Name='cloudflared'"
$reg=Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\cloudflared'
@(
 ('SERVICE_STATE='+$svc.State),
 ('SERVICE_STARTMODE='+$svc.StartMode),
 ('DELAYED_AUTO='+$reg.DelayedAutoStart),
 ('FAILURE_ACTIONS_PRESENT='+[bool]$reg.FailureActions)
) | Set-Content 'C:\ProgramData\Numina\recovery-status.txt'
