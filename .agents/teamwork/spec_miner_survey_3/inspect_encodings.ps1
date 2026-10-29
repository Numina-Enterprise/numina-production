$files = @(
    "C:\Users\sam\.gemini\antigravity\scratch\AGENTS.md",
    "C:\Users\sam\.gemini\antigravity\scratch\GEMINI.md",
    "C:\Users\sam\.gemini\antigravity\scratch\numina-doc-alignment\AGENTS.md",
    "C:\Users\sam\.gemini\antigravity\scratch\numina-doc-alignment\GEMINI.md",
    "C:\Users\sam\.gemini\antigravity\scratch\manifest-verifier\AGENTS.md",
    "C:\Users\sam\.gemini\antigravity\scratch\manifest-verifier\GEMINI.md",
    "C:\Users\sam\.gemini\antigravity\scratch\tailscale-ssh-policy\AGENTS.md",
    "C:\Users\sam\.gemini\antigravity\scratch\tailscale-ssh-policy\GEMINI.md"
)

$results = foreach ($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($f)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $rawText = [System.IO.File]::ReadAllText($f)
    $hasCrlf = $rawText.Contains("`r`n")
    $textWithoutCrlf = $rawText.Replace("`r`n", "")
    $hasLfOnly = $textWithoutCrlf.Contains("`n")
    $hasCrOnly = $textWithoutCrlf.Contains("`r")
    
    [PSCustomObject]@{
        Name = (Split-Path -Leaf (Split-Path -Parent $f)) + "\" + (Split-Path -Leaf $f)
        Length = $bytes.Length
        HasBOM = $hasBom
        HasCRLF = $hasCrlf
        HasLFOnly = $hasLfOnly
        HasCrOnly = $hasCrOnly
    }
}

$results | Format-Table -AutoSize
