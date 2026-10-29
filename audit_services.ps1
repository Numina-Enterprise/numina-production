try {
    $services = Get-CimInstance -ClassName Win32_Service -Filter "Name = 'AppReadiness' or Name like 'BcastDVR%'" -ErrorAction Stop
    $services | Select-Object Name, DisplayName, State, StartMode | Format-Table -AutoSize
} catch {
    # If SCM or CIM is restricted, use sc.exe or report unprivileged state
    $scOutput = sc.exe query AppReadiness 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Output "Queried via SC.exe:"
        Write-Output ($scOutput | Out-String)
    } else {
        Write-Output "Service Control Manager query requires elevated privileges or is restricted in this execution context."
    }
}
