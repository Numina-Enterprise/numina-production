$paths = @(
    'C:\Windows\diagnostics',
    'C:\Windows\Logs',
    'C:\Windows\Debug',
    'C:\Windows\Cursors',
    'C:\Windows\CbsTemp',
    'C:\Windows\Branding',
    'C:\Windows\assembly'
)

$results = foreach ($item in $paths) {
    if (Test-Path -LiteralPath $item) {
        $acl = Get-Acl -LiteralPath $item
        [PSCustomObject]@{
            Path = $item
            Owner = $acl.Owner
            AccessRules = $acl.Access.Count
            InheritanceProtected = $acl.AreAccessRulesProtected
        }
    } else {
        [PSCustomObject]@{
            Path = $item
            Owner = 'NotFound'
            AccessRules = 0
            InheritanceProtected = $false
        }
    }
}
$results | Format-Table -AutoSize
