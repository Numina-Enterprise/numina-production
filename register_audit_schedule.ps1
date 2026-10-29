<#
.SYNOPSIS
    Registers or runs the Numina Cross-Platform Victory Audit as a recurring automation task.
.DESCRIPTION
    Supports Windows Scheduled Task registration and standalone periodic polling.
    Part of the /automation operational pipeline.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet("Register", "Unregister", "RunOnce", "Status")]
    [string]$Action = "RunOnce",
    [int]$IntervalMinutes = 60
)

$TaskName = "NuminaVictoryAuditMonitor"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerScript = Join-Path $ScriptDir "unified_audit_orchestrator.ps1"

switch ($Action) {
    "RunOnce" {
        Write-Host "[+] Executing one-time unified audit run..." -ForegroundColor Cyan
        & powershell.exe -ExecutionPolicy Bypass -File $RunnerScript
    }
    "Register" {
        Write-Host "[+] Registering Windows Scheduled Task: $TaskName (Every $IntervalMinutes minutes)..." -ForegroundColor Green
        $ActionCmd = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunnerScript`""
        $Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
        $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
        
        try {
            Register-ScheduledTask -TaskName $TaskName -Action $ActionCmd -Trigger $Trigger -Settings $Settings -Description "Numina Cross-Platform Zero-Trust Victory Audit Monitor" -Force
            Write-Host "[✓] Task '$TaskName' registered successfully." -ForegroundColor Green
        } catch {
            Write-Warning "Failed to register Scheduled Task: $($_.Exception.Message). (Elevated Administrator permissions required for Task Scheduler)."
        }
    }
    "Unregister" {
        Write-Host "[+] Removing Windows Scheduled Task: $TaskName..." -ForegroundColor Yellow
        try {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
            Write-Host "[✓] Task '$TaskName' removed." -ForegroundColor Green
        } catch {
            Write-Warning "Task '$TaskName' not found or removal failed: $($_.Exception.Message)"
        }
    }
    "Status" {
        $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($task) {
            $info = Get-ScheduledTaskInfo -TaskName $TaskName
            [PSCustomObject]@{
                TaskName = $task.TaskName
                State = $task.State
                LastRunTime = $info.LastRunTime
                LastTaskResult = $info.LastTaskResult
                NextRunTime = $info.NextRunTime
            } | Format-Table -AutoSize
        } else {
            Write-Host "Scheduled task '$TaskName' is not registered." -ForegroundColor DarkYellow
        }
    }
}
