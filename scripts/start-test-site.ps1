# Junction test site
#
# Runs the website and the PDF translator on this computer and makes the website
# reachable at a temporary https://....trycloudflare.com address through a free
# Cloudflare Quick Tunnel. Started by start-test-site.bat (see TEST-SITE.md).
#
#   1. checks that Node.js, Python and cloudflared are installed
#   2. checks the settings files (test-site.env, backend\.env, pdf-translator\.env)
#   3. installs missing packages and builds the website pages
#   4. starts the translator, the website and the tunnel, each in its own window
#   5. shows the address to send to testers (also copied and saved to
#      test-site-address.txt)
#
# Press Enter in this window to stop everything.
#
# Written for Windows PowerShell 5.1 (built into Windows 10/11). Keep this file
# plain ASCII: Windows PowerShell 5.1 misreads other characters.

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$Root          = Split-Path -Parent $PSScriptRoot
$BackendDir    = Join-Path $Root 'backend'
$FrontendDir   = Join-Path $Root 'frontend'
$TranslatorDir = Join-Path $Root 'pdf-translator'
$SettingsFile  = Join-Path $Root 'test-site.env'
$SettingsTemplate = Join-Path $Root 'test-site.env.example'
$AddressFile   = Join-Path $Root 'test-site-address.txt'

Set-Location $Root
$Host.UI.RawUI.WindowTitle = 'Junction test site'

# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
function Step($text) {
    Write-Host ''
    Write-Host "== $text" -ForegroundColor Cyan
}

function Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Note($text) { Write-Host "   $text" -ForegroundColor Yellow }

function Fail($text) {
    Write-Host ''
    Write-Host 'PROBLEM:' -ForegroundColor Red
    foreach ($line in ($text -split "`n")) { Write-Host "   $line" -ForegroundColor Red }
    Write-Host ''
    Write-Host 'Fix the problem above, then run start-test-site.bat again.'
    exit 1
}

# KEY=value lines from a .env-style file (comments and blank lines ignored).
function Read-EnvFile($path) {
    $values = @{}
    if (-not (Test-Path -LiteralPath $path)) { return $values }
    foreach ($line in [System.IO.File]::ReadAllLines($path)) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#') -or -not $t.Contains('=')) { continue }
        $i = $t.IndexOf('=')
        $key = $t.Substring(0, $i).Trim()
        $value = $t.Substring($i + 1).Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$key] = $value
    }
    return $values
}

function Get-Setting($values, $key, $default) {
    if ($values.ContainsKey($key) -and $values[$key] -ne '') { return $values[$key] }
    return $default
}

function Test-PortInUse($port) {
    $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return [bool]$listening
}

function Wait-ForUrl($url, $seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}

# Opens a new window titled $title that runs $command (cmd.exe syntax) in $folder.
# The window stays open afterwards so any error message can be read.
function Start-Window($title, $folder, $command) {
    return Start-Process -FilePath 'cmd.exe' -ArgumentList "/k title $title & $command" -WorkingDirectory $folder -PassThru
}

function Stop-Window($process) {
    if ($process -and -not $process.HasExited) {
        & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
    }
}

function Quote($path) { return '"' + $path + '"' }

# ---------------------------------------------------------------------------
# 1. programs
# ---------------------------------------------------------------------------
Step 'Checking programs'

$node = Get-Command 'node.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
$npm = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node -or -not $npm) {
    Fail "Node.js was not found.`nInstall the LTS version from https://nodejs.org, then open a new window and try again."
}
Ok ('Node.js ' + (& $node.Source --version))

# Python: the first one that works, preferring one that already has the
# translator's packages (Miniconda/Anaconda are often not on PATH).
$pythonCandidates = New-Object System.Collections.ArrayList
$found = Get-Command 'python.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($found) { [void]$pythonCandidates.Add([pscustomobject]@{ Exe = $found.Source; Extra = @() }) }
$found = Get-Command 'py.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($found) { [void]$pythonCandidates.Add([pscustomobject]@{ Exe = $found.Source; Extra = @('-3') }) }
foreach ($folder in @('miniconda3', 'anaconda3')) {
    $exe = Join-Path (Join-Path $env:USERPROFILE $folder) 'python.exe'
    if (Test-Path -LiteralPath $exe) { [void]$pythonCandidates.Add([pscustomobject]@{ Exe = $exe; Extra = @() }) }
}

$PythonExe = $null
$PythonArgs = @()
$PythonHasPackages = $false
$packageCheck = 'import flask, pdfplumber, pikepdf, reportlab, pypdfium2, PIL, anthropic'
foreach ($candidate in $pythonCandidates) {
    $exe = $candidate.Exe
    $extra = @($candidate.Extra)
    $version = & $exe @extra -c 'import sys; print(sys.version_info[0])' 2>$null
    if ($LASTEXITCODE -ne 0 -or "$version".Trim() -ne '3') { continue }
    & $exe @extra -c $packageCheck 2>$null
    $hasPackages = ($LASTEXITCODE -eq 0)
    if (-not $PythonExe -or ($hasPackages -and -not $PythonHasPackages)) {
        $PythonExe = $exe
        $PythonArgs = $extra
        $PythonHasPackages = $hasPackages
    }
    if ($hasPackages) { break }
}
if (-not $PythonExe) {
    Fail "Python 3 was not found.`nInstall it from https://www.python.org (tick 'Add python.exe to PATH'), then try again."
}
Ok ('Python ' + (& $PythonExe @PythonArgs -c 'import platform; print(platform.python_version())') + "  ($PythonExe)")

$cloudflared = $null
$found = Get-Command 'cloudflared.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($found) { $cloudflared = $found.Source }
if (-not $cloudflared) {
    $places = @(
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe'),
        (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
        (Join-Path $Root 'cloudflared.exe'),
        (Join-Path $Root 'cloudflared-windows-amd64.exe')
    )
    foreach ($place in $places) {
        if ($place -and (Test-Path -LiteralPath $place)) { $cloudflared = $place; break }
    }
}
if (-not $cloudflared) {
    Fail ("cloudflared was not found. Install it with this command in a terminal:`n" +
          "   winget install --id Cloudflare.cloudflared`n" +
          "then close this window and run start-test-site.bat again.`n" +
          "(Or download cloudflared-windows-amd64.exe from Cloudflare's GitHub page and put it in this folder.)")
}
Ok "cloudflared ($cloudflared)"

# ---------------------------------------------------------------------------
# 2. settings
# ---------------------------------------------------------------------------
Step 'Checking settings'

if (-not (Test-Path -LiteralPath $SettingsFile)) {
    Copy-Item -LiteralPath $SettingsTemplate -Destination $SettingsFile
    Start-Process -FilePath 'notepad.exe' -ArgumentList (Quote $SettingsFile)
    Fail "test-site.env has just been created and opened in Notepad.`nType a password after SITE_PASSWORD=, save the file, and run start-test-site.bat again."
}
$site = Read-EnvFile $SettingsFile
$SitePassword = Get-Setting $site 'SITE_PASSWORD' ''
if ($SitePassword -eq '') {
    Start-Process -FilePath 'notepad.exe' -ArgumentList (Quote $SettingsFile)
    Fail "Choose the password testers will type: put it after SITE_PASSWORD= in test-site.env (now open in Notepad), save, and run start-test-site.bat again."
}
$TestMode = Get-Setting $site 'TRANSLATOR_TEST_MODE' '1'
$RequireVerification = Get-Setting $site 'REQUIRE_EMAIL_VERIFICATION' 'false'

$backendEnvFile = Join-Path $BackendDir '.env'
$translatorEnvFile = Join-Path $TranslatorDir '.env'
if (-not (Test-Path -LiteralPath $backendEnvFile)) {
    Fail "backend\.env is missing. Copy backend\.env.example to backend\.env and fill it in (see README.md)."
}
if (-not (Test-Path -LiteralPath $translatorEnvFile)) {
    Fail "pdf-translator\.env is missing. Copy pdf-translator\.env.example to pdf-translator\.env and fill it in (see README.md)."
}
$backendEnv = Read-EnvFile $backendEnvFile
$translatorEnv = Read-EnvFile $translatorEnvFile

$SitePort = [int](Get-Setting $backendEnv 'PORT' '3001')
$TranslatorPort = [int](Get-Setting $translatorEnv 'TRANSLATOR_PORT' '5000')
$translatorUrl = Get-Setting $backendEnv 'TRANSLATOR_URL' 'http://127.0.0.1:5000'
if ($translatorUrl -notmatch ":$TranslatorPort/?$") {
    Note "backend\.env has TRANSLATOR_URL=$translatorUrl but the translator uses port $TranslatorPort. The Documents page may not reach it."
}
$secretA = Get-Setting $backendEnv 'TRANSLATOR_SECRET' ''
$secretB = Get-Setting $translatorEnv 'TRANSLATOR_SECRET' ''
if ($secretA -eq '' -or $secretA -ne $secretB) {
    Note 'TRANSLATOR_SECRET is missing or different in backend\.env and pdf-translator\.env. The Documents page will not work until they match.'
}
if ($TestMode -eq '0' -and (Get-Setting $translatorEnv 'ANTHROPIC_API_KEY' '') -eq '') {
    Fail "TRANSLATOR_TEST_MODE=0 in test-site.env asks for real translations, but ANTHROPIC_API_KEY is empty in pdf-translator\.env."
}

# A VITE_API_URL in the front end's own settings would be built into the pages
# and make testers' browsers look for the API on their own computer.
foreach ($name in @('.env', '.env.local', '.env.production', '.env.production.local')) {
    $frontendEnv = Read-EnvFile (Join-Path $FrontendDir $name)
    if ((Get-Setting $frontendEnv 'VITE_API_URL' '') -ne '') {
        Fail "frontend\$name sets VITE_API_URL. Remove that line (or put # in front of it) and try again.`nThe built site must call its own address, not $($frontendEnv['VITE_API_URL'])."
    }
}

if ($TestMode -eq '0') { Ok 'PDF translations: REAL (Claude, charged to your API key)' }
else { Ok 'PDF translations: free test mode' }
if ((Get-Setting $backendEnv 'AZURE_TRANSLATOR_KEY' '') -ne '') { Ok 'Chat translations: Azure (key in backend\.env)' }
else { Ok 'Chat translations: free test mode' }
if ($RequireVerification -eq 'false') { Ok 'Sign-up: no email verification (accounts work at once)' }

foreach ($port in @($SitePort, $TranslatorPort)) {
    if (Test-PortInUse $port) {
        Fail "Port $port is already in use: the website or translator seems to be running already.`nClose those windows (for example npm run dev or python server.py) and try again."
    }
}

# ---------------------------------------------------------------------------
# 3. packages and build
# ---------------------------------------------------------------------------
Step 'Preparing the website'

foreach ($dir in @($BackendDir, $FrontendDir)) {
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'node_modules'))) {
        Note "Installing packages in $(Split-Path -Leaf $dir) (first time only)..."
        Push-Location $dir
        & $npm.Source install --no-audit --no-fund
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { Fail "npm install failed in $(Split-Path -Leaf $dir). See the messages above." }
    }
}

if (-not $PythonHasPackages) {
    Note 'Installing the translator''s Python packages (first time only)...'
    Push-Location $TranslatorDir
    & $PythonExe @PythonArgs -m pip install -r requirements.txt
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Fail 'pip install failed. See the messages above.' }
}

Note 'Building the website pages...'
Push-Location $FrontendDir
& $npm.Source run build
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Fail 'The website build failed. See the messages above.' }
Ok 'Website built'

# ---------------------------------------------------------------------------
# 4. start everything
# ---------------------------------------------------------------------------
Step 'Starting'

$windows = @()
try {
    # Translator: private, on this computer only.
    $env:TRANSLATOR_TEST_MODE = $TestMode
    $env:PYTHONUNBUFFERED = '1'
    $pythonCommand = (Quote $PythonExe)
    if ($PythonArgs.Count -gt 0) { $pythonCommand += ' ' + ($PythonArgs -join ' ') }
    $translator = Start-Window 'Junction translator' $TranslatorDir "$pythonCommand server.py"
    $windows += $translator
    Remove-Item Env:TRANSLATOR_TEST_MODE -ErrorAction SilentlyContinue
    if (Wait-ForUrl "http://127.0.0.1:$TranslatorPort/api/health" 60) { Ok "Translator running (port $TranslatorPort)" }
    else { Note 'The translator did not answer yet. Check its window; the site works, but the Documents page may say the translator is not running.' }

    # Website: only reachable from this computer; the tunnel is the way in.
    $env:HOST = '127.0.0.1'
    $env:TRUST_PROXY = '1'
    $env:SITE_PASSWORD = $SitePassword
    $env:REQUIRE_EMAIL_VERIFICATION = $RequireVerification
    $website = Start-Window 'Junction website' $BackendDir ((Quote $npm.Source) + ' start')
    $windows += $website
    foreach ($name in @('HOST', 'TRUST_PROXY', 'SITE_PASSWORD', 'REQUIRE_EMAIL_VERIFICATION')) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    if (-not (Wait-ForUrl "http://127.0.0.1:$SitePort/api/health" 60)) {
        Fail 'The website did not start. Look at the "Junction website" window for the error.'
    }
    Ok "Website running (port $SitePort, this computer only)"

    # Tunnel: the metrics address lets this script read the new public address.
    $metricsPort = 0
    foreach ($candidate in 20241..20249) {
        if (-not (Test-PortInUse $candidate)) { $metricsPort = $candidate; break }
    }
    if ($metricsPort -eq 0) { Fail 'No free port found for cloudflared (20241-20249 are all in use).' }
    $tunnelCommand = (Quote $cloudflared) + " tunnel --url http://127.0.0.1:$SitePort --metrics 127.0.0.1:$metricsPort"
    $tunnel = Start-Window 'Junction tunnel' $Root $tunnelCommand
    $windows += $tunnel

    $address = $null
    $deadline = (Get-Date).AddSeconds(60)
    while (-not $address -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
        try {
            # cloudflared answers {"hostname":"https://....trycloudflare.com"}
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$metricsPort/quicktunnel" -UseBasicParsing -TimeoutSec 3
            if ([string]$response.Content -match '"hostname"\s*:\s*"([^"]+)"') {
                $address = $Matches[1]
                if (-not $address.StartsWith('https://')) { $address = 'https://' + $address }
            }
        } catch { }
    }
    if (-not $address) {
        Fail ("The tunnel did not start. Look at the ""Junction tunnel"" window for the error.`n" +
              "If you are on a school or office network, it may block Cloudflare tunnels: try another network.")
    }

    Set-Content -LiteralPath $AddressFile -Value $address -Encoding ASCII
    try { Set-Clipboard -Value $address } catch { }

    Write-Host ''
    Write-Host '  ==========================================================' -ForegroundColor Green
    Write-Host '   The test site is online at:' -ForegroundColor Green
    Write-Host ''
    Write-Host "     $address" -ForegroundColor White
    Write-Host ''
    Write-Host '   Send this address and the site password to your testers.' -ForegroundColor Green
    Write-Host '   (Copied to the clipboard and saved in test-site-address.txt.)' -ForegroundColor Green
    Write-Host '   It can take up to a minute before the address opens.' -ForegroundColor Green
    Write-Host '  ==========================================================' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Keep this computer awake and these windows open while people test.'
    Write-Host 'Press Enter here to stop the test site.' -ForegroundColor Cyan

    # Wait for Enter, and say so if one of the windows gets closed.
    $names = @{ $translator.Id = 'translator'; $website.Id = 'website'; $tunnel.Id = 'tunnel' }
    $reported = @{}
    while ($true) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq 'Enter') { break }
        }
        foreach ($w in $windows) {
            if ($w.HasExited -and -not $reported.ContainsKey($w.Id)) {
                $reported[$w.Id] = $true
                Note "The $($names[$w.Id]) window was closed, so the test site no longer works fully. Press Enter to stop everything, then start again."
            }
        }
        Start-Sleep -Milliseconds 500
    }
}
finally {
    Write-Host ''
    Write-Host 'Stopping the test site...'
    foreach ($w in $windows) { Stop-Window $w }
    if (Test-Path -LiteralPath $AddressFile) { Remove-Item -LiteralPath $AddressFile -ErrorAction SilentlyContinue }
    Write-Host 'Stopped. The address no longer works.'
}
