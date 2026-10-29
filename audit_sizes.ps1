$targets = @(
    'C:\Windows\CbsTemp',
    'C:\Windows\Logs',
    'C:\Windows\Debug'
)

$results = foreach ($t in $targets) {
    if (Test-Path -LiteralPath $t) {
        $files = Get-ChildItem -LiteralPath $t -Recurse -File -Force -ErrorAction SilentlyContinue
        $size = ($files | Measure-Object -Property Length -Sum).Sum
        $count = ($files | Measure-Object).Count
        [PSCustomObject]@{
            Directory = $t
            FileCount = $count
            TotalSizeMB = [math]::Round(($size / 1MB), 2)
        }
    }
}
$results | Format-Table -AutoSize
