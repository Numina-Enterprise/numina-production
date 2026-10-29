$ErrorActionPreference='Stop'
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
foreach($name in @('NuminaOriginBoot','NuminaSystemWatchdog')){
  $t=Get-ScheduledTask -TaskName $name
  Set-ScheduledTask -TaskName $name -Settings $settings | Out-Null
}
Restart-Service cloudflared -Force
Start-Sleep -Seconds 6
$svc=Get-CimInstance Win32_Service -Filter "Name='cloudflared'"
$lines=@('SERVICE_STATE='+$svc.State,'SERVICE_PID='+$svc.ProcessId)
foreach($name in @('NuminaOriginBoot','NuminaSystemWatchdog')){
  $t=Get-ScheduledTask -TaskName $name
  $s=$t.Settings
  $lines += ($name+'|RunAs='+$t.Principal.UserId+'|RunLevel='+$t.Principal.RunLevel+'|BatteryAllowed='+(-not $s.DisallowStartIfOnBatteries)+'|StopOnBattery='+$s.StopIfGoingOnBatteries+'|StartWhenAvailable='+$s.StartWhenAvailable+'|RestartCount='+$s.RestartCount+'|MultipleInstances='+$s.MultipleInstances)
}
try{$ok=((Invoke-WebRequest -UseBasicParsing -Uri 'https://tunnel.numinalabs.xyz/final-build.json' -TimeoutSec 15).StatusCode -eq 200)}catch{$ok=$false}
$lines += ('PUBLIC_200='+$ok)
Set-Content 'C:\ProgramData\Numina\task-hardening-status.txt' $lines

