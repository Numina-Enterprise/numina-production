$ErrorActionPreference='Stop'
$token='C:\ProgramData\cloudflared\token'
icacls $token /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null
$acl=Get-Acl $token
$rows=$acl.Access | ForEach-Object { $_.IdentityReference.Value+'|'+$_.FileSystemRights+'|'+$_.AccessControlType+'|Inherited='+$_.IsInherited }
Set-Content 'C:\ProgramData\Numina\token-acl-status.txt' $rows
