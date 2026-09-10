Get-ChildItem -Recurse -Include *.html,*.js,*.xml,*.txt,*.ejs,*.json |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\\.git\\' } |
    ForEach-Object {
        $content = Get-Content $_.FullName -Raw
        if ($content -match 'stembridge-speaks\.onrender\.com') {
            $newContent = $content -replace 'stembridge-speaks\.onrender\.com', 'stembridgespeaks.tech'
            Set-Content -Path $_.FullName -Value $newContent -NoNewline
            Write-Host "Updated: $($_.FullName)"
        }
    }

Write-Host ""
Write-Host "Done. Run 'git status' to see which files changed."