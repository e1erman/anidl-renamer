// ==UserScript==
// @name         AniWorld Downloader – Rename Script
// @namespace    anidl-renamer
// @version      1.3.2
// @author       eierman
// @license      MIT
// @homepageURL  https://github.com/e1erman/anidl-renamer
// @supportURL   https://github.com/e1erman/anidl-renamer/issues
// @downloadURL  https://github.com/e1erman/anidl-renamer/releases/latest/download/anidl-renamer.user.js
// @updateURL    https://github.com/e1erman/anidl-renamer/releases/latest/download/anidl-renamer.user.js
// @description  Adds a button to every season (including movies/extras) in the AniWorld Downloader web UI that downloads a script to rename the files with their real episode titles.
// @match        *://*/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

/* eslint-disable no-alert */

// ---------------------------------------------------------------------------
// Settings
// Placeholders in the formats: {series} {year} {season} {episode} {title}
// ---------------------------------------------------------------------------
const DEFAULTS = {
  extrasFormat: "{series} - {title}",
  seasonFormat: "{series} S{season}E{episode} - {title}",
};

const PLATFORMS = [
  { id: "windows", label: "Windows", hint: "double-click (.cmd)", ext: "cmd" },
  { id: "linux", label: "Linux / NAS", hint: "bash file.sh", ext: "sh" },
  { id: "mac", label: "macOS", hint: "double-click (.command)", ext: "command" },
];

// ---------------------------------------------------------------------------
// Building names
// ---------------------------------------------------------------------------

/** Removes characters that are not allowed in file names. */
function sanitizeName(text) {
  return String(text)
    .replace(/\s*:\s*/g, " - ")
    .replace(/[\/\\*?"<>|\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
}

function formatName(template, vars) {
  const filled = template.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match
  );
  return sanitizeName(filled);
}

/** Lowercase a-z/0-9 only, so the script can recognise the series folder. */
function seriesKey(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Default name the downloader gives a file (without extension), e.g. "Angel Beats! S00E001".
 * Same as clean_title() in the downloader: only removes <>:"/\|?*
 * Used by the undo script when a file was renamed without a record.
 */
function downloaderBaseName(series, season, episode) {
  const title = String(series).replace(/[<>:"\/\\|?*]/g, "").trim();
  return `${title} S${String(season).padStart(2, "0")}E${String(episode).padStart(3, "0")}`;
}

/**
 * info: { series, year, label, seasonNumber, isExtras, episodes: [{ number, title }] }
 * Returns [{ episode, oldBase, newName }]. Episodes without a title are skipped.
 */
function buildEntries(info, settings) {
  const template = info.isExtras ? settings.extrasFormat : settings.seasonFormat;
  return info.episodes
    .filter((ep) => ep.title && ep.title.trim())
    .map((ep) => ({
      episode: ep.number,
      oldBase: downloaderBaseName(info.series, info.seasonNumber, ep.number),
      newName: formatName(template, {
        series: info.series,
        year: info.year || "",
        season: String(info.seasonNumber).padStart(2, "0"),
        episode: String(ep.number).padStart(3, "0"),
        title: ep.title,
      }),
    }))
    .filter((entry) => entry.newName);
}

// ---------------------------------------------------------------------------
// Script generation
// ---------------------------------------------------------------------------

function shQuote(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

function psQuote(text) {
  return "'" + String(text).replace(/'/g, "''") + "'";
}

function oneLine(text) {
  return String(text).replace(/[\r\n]+/g, " ");
}

/**
 * Bash script for Linux and macOS.
 * Deliberately compatible with Bash 3.2 (the default on macOS): no mapfile,
 * no associative arrays, no ${x,,}.
 */
function generateSh(info, entries, fileName, platform) {
  const eps = entries.map((e) => e.episode).join(" ");
  const names = entries.map((e) => "  " + shQuote(e.newName)).join("\n");
  const olds = entries.map((e) => "  " + shQuote(e.oldBase)).join("\n");
  const usage =
    platform === "mac"
      ? `# Usage (macOS): put this script into the series folder. Then either
#   - once in Terminal: chmod +x ${shQuote(fileName)}
#     then start it by double-clicking (the first time: right-click > Open), or
#   - in Terminal: bash ${shQuote(fileName)}`
      : `# Usage (Linux): put this script into the series folder and run:
#   bash ${shQuote(fileName)}`;

  return `#!/usr/bin/env bash
# Rename: ${oneLine(info.series)} – ${oneLine(info.label)}
# Created with "AniWorld Downloader – Rename Script" (Tampermonkey)
#
${usage}
#
# It shows a preview first and only renames after you confirm.
# An undo script is created next to it so you can revert everything.

cd "$(dirname "$0")" || exit 1

SEASON=${info.seasonNumber}
SERIES_KEY=${shQuote(seriesKey(info.series))}
EPS=(${eps})
NEW=(
${names}
)
# Default downloader names, used when a file has to be reverted without a record
OLD=(
${olds}
)

pause() {
  if [ -t 0 ]; then read -r -p "Press Enter to close " _; fi
}

# Undo file: always the same one per folder, always created.
# Appended at the bottom:
#   "#M<TAB>series<TAB>new name<TAB>downloader name"  for every episode of the season
#   "#U<TAB>new path<TAB>old name"                     for every actual rename
UNDO="undo-rename.sh"
LEGACY="undo-umbenennen.sh"
TAB=$(printf '\\t')
# Create it, or update an older version / take over the old German undo file (entries are kept)
if [ ! -f "$UNDO" ] || ! grep -q '^# anidl-undo v3$' "$UNDO" || [ -f "$LEGACY" ]; then
  OLDDATA=$( { grep "^#[UM]$TAB" "$LEGACY" 2>/dev/null; grep "^#[UM]$TAB" "$UNDO" 2>/dev/null; } | awk '!seen[$0]++')
  cat > "$UNDO" <<'UNDO_EOF'
#!/usr/bin/env bash
# anidl-undo v3
# Reverts all renames in this folder.
# Only files that still exist are renamed back.
# Run with: bash undo-rename.sh

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")" || exit 1
TAB=$(printf '\\t')
P="#U$TAB"
M="#M$TAB"

# #U = recorded rename, #M = mapping new name -> downloader name for the whole season
ENTRIES=()
MAPS=()
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    "$P"*) ENTRIES+=("\${line#"$P"}") ;;
    "$M"*) MAPS+=("\${line#"$M"}") ;;
  esac
done < "$SELF"

n=0
s=0

# 1) Recorded renames, newest first
i=$((\${#ENTRIES[@]} - 1))
while [ "$i" -ge 0 ]; do
  e=\${ENTRIES[$i]}
  i=$((i - 1))
  now=\${e%%"$TAB"*}
  old=\${e#*"$TAB"}
  [ -e "$now" ] || continue
  target="\${now%/*}/$old"
  if [ -e "$target" ]; then
    echo "Skipped, already exists: $target"
    s=$((s + 1))
    continue
  fi
  if mv -n -- "$now" "$target" && [ -e "$target" ]; then
    echo "  $now -> $old"
    n=$((n + 1))
  else
    echo "Failed: $now"
    s=$((s + 1))
  fi
done

# 2) Rename remaining files with a new name back using the season mapping
if [ "\${#MAPS[@]}" -gt 0 ]; then
  FILES=()
  while IFS= read -r -d '' f; do
    FILES+=("$f")
  done < <(find . -type f \\( -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.webm' -o -iname '*.avi' -o -iname '*.m4v' \\) -print0)

  for m in "\${MAPS[@]}"; do
    key=\${m%%"$TAB"*}
    rest=\${m#*"$TAB"}
    new=\${rest%%"$TAB"*}
    oldbase=\${rest#*"$TAB"}

    hits=()
    preferred=()
    for f in "\${FILES[@]}"; do
      b=\${f##*/}
      [ "\${b%.*}" = "$new" ] || continue
      hits+=("$f")
      kf=$(printf '%s' "$f" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
      case "$kf" in *"$key"*) preferred+=("$f") ;; esac
    done
    if [ "\${#preferred[@]}" -gt 0 ]; then hits=("\${preferred[@]}"); fi

    for f in "\${hits[@]}"; do
      [ -e "$f" ] || continue
      target="\${f%/*}/$oldbase.\${f##*.}"
      if [ -e "$target" ]; then
        echo "Skipped, already exists: $target"
        s=$((s + 1))
        continue
      fi
      if mv -n -- "$f" "$target" && [ -e "$target" ]; then
        echo "  $f -> $oldbase.\${f##*.}"
        n=$((n + 1))
      else
        echo "Failed: $f"
        s=$((s + 1))
      fi
    done
  done
fi

if [ "$n" -eq 0 ] && [ "$s" -eq 0 ]; then
  echo "Nothing to rename back."
else
  echo "Done: $n renamed back, $s skipped."
fi
if [ -t 0 ]; then read -r -p "Press Enter to close " _; fi
exit 0

# Data (appended automatically):
UNDO_EOF
  if [ -n "$OLDDATA" ]; then printf '%s\\n' "$OLDDATA" >> "$UNDO"; fi
  rm -f "$LEGACY"
fi

# Record the mapping for the whole season, even if nothing gets renamed
for i in "\${!EPS[@]}"; do
  line="#M$TAB$SERIES_KEY$TAB\${NEW[$i]}$TAB\${OLD[$i]}"
  grep -qxF -- "$line" "$UNDO" 2>/dev/null || printf '%s\\n' "$line" >> "$UNDO"
done

FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(find . -type f \\( -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.webm' -o -iname '*.avi' -o -iname '*.m4v' \\) -print0)

# Precompute lowercase file names and path keys once
LOWER=()
KEYS=()
for f in "\${FILES[@]}"; do
  LOWER+=("$(printf '%s' "\${f##*/}" | tr '[:upper:]' '[:lower:]')")
  KEYS+=("$(printf '%s' "$f" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')")
done

SRC=()
DST=()
i=0
while [ "$i" -lt "\${#EPS[@]}" ]; do
  ep=\${EPS[$i]}
  new=\${NEW[$i]}
  i=$((i + 1))
  re="s0*\${SEASON}e0*\${ep}([^0-9]|$)"

  matches=()
  preferred=()
  j=0
  while [ "$j" -lt "\${#FILES[@]}" ]; do
    if [[ \${LOWER[$j]} =~ $re ]]; then
      matches+=("$j")
      # Prefer files whose path contains the series name
      if [ -n "$SERIES_KEY" ]; then
        case "\${KEYS[$j]}" in *"$SERIES_KEY"*) preferred+=("$j") ;; esac
      fi
    fi
    j=$((j + 1))
  done
  if [ "\${#preferred[@]}" -gt 0 ]; then matches=("\${preferred[@]}"); fi

  if [ "\${#matches[@]}" -eq 0 ]; then
    echo "Not found: episode $ep"
    continue
  fi

  for j in "\${matches[@]}"; do
    src=\${FILES[$j]}
    dir=\${src%/*}
    ext=\${src##*.}
    dst="$dir/$new.$ext"
    [ "$src" = "$dst" ] && continue
    taken=0
    for d in "\${DST[@]}"; do
      [ "$d" = "$dst" ] && taken=1
    done
    if [ -e "$dst" ] || [ "$taken" -eq 1 ]; then
      echo "Skipped, target already exists: $dst"
      continue
    fi
    SRC+=("$src")
    DST+=("$dst")
  done
done

if [ "\${#SRC[@]}" -eq 0 ]; then
  echo
  echo "Nothing to rename."
  echo "To undo: bash $UNDO"
  pause
  exit 0
fi

echo
echo "Preview (\${#SRC[@]} files):"
for i in "\${!SRC[@]}"; do
  printf '  %s\\n    -> %s\\n' "\${SRC[$i]}" "\${DST[$i]##*/}"
done
echo
read -r -p "Rename now? [y/N] " answer
case "$answer" in
  [yYjJ]*) ;;
  *)
    echo "Cancelled, nothing changed."
    pause
    exit 0
    ;;
esac

ok=0
for i in "\${!SRC[@]}"; do
  if mv -n -- "\${SRC[$i]}" "\${DST[$i]}" && [ -e "\${DST[$i]}" ]; then
    line="#U$TAB\${DST[$i]}$TAB\${SRC[$i]##*/}"
    grep -qxF -- "$line" "$UNDO" 2>/dev/null || printf '%s\\n' "$line" >> "$UNDO"
    ok=$((ok + 1))
  else
    echo "Failed: \${SRC[$i]}"
  fi
done

echo "Done: $ok of \${#SRC[@]} files renamed."
echo "To undo: bash $UNDO"
pause
`;
}

/**
 * Windows: .cmd file that starts with a double-click. The top part is batch,
 * which starts PowerShell and runs everything after the #ANIDL_PS# marker.
 * The file must not have a BOM, otherwise cmd chokes on the first line.
 */
const CMD_HEADER = [
  "@echo off",
  "setlocal",
  'set "ANIDL_SELF=%~f0"',
  "powershell -NoProfile -ExecutionPolicy Bypass -Command \"iex ((Get-Content -LiteralPath $env:ANIDL_SELF -Raw -Encoding UTF8) -split ('#ANIDL'+'_PS#'), 2)[1]\"",
  "exit /b",
  "#ANIDL_PS#",
];

function generateCmd(info, entries, fileName) {
  const eps = entries
    .map((e) => `  @{ Ep = ${e.episode}; New = ${psQuote(e.newName)}; Old = ${psQuote(e.oldBase)} }`)
    .join("\n");
  const header = CMD_HEADER.map((line) => "  " + psQuote(line)).join(",\n");

  const ps = `# Rename: ${oneLine(info.series)} – ${oneLine(info.label)}
# Created with "AniWorld Downloader – Rename Script" (Tampermonkey)
#
# Usage: put this file into the series folder and double-click it.
# It shows a preview first and only renames after you confirm.
# An undo script is created next to it so you can revert everything.

try {
  Set-Location -LiteralPath (Split-Path -Parent $env:ANIDL_SELF) -ErrorAction Stop
} catch {
  Write-Host "Could not open the script's folder: $($_.Exception.Message)"
  Read-Host "Press Enter to close" | Out-Null
  exit 1
}

$Season = ${info.seasonNumber}
$SeriesKey = ${psQuote(seriesKey(info.series))}
$Episodes = @(
${eps}
)
$CmdHeader = @(
${header}
)

# Undo file: always the same one per folder, always created (also starts with a double-click).
# Appended at the bottom:
#   "#M<TAB>series<TAB>new name<TAB>downloader name"  for every episode of the season
#   "#U<TAB>new path<TAB>old name"                     for every actual rename
$UndoBody = @'
# anidl-undo v3
# Reverts all renames in this folder.
# Only files that still exist are renamed back. Double-click to start.

try {
  Set-Location -LiteralPath (Split-Path -Parent $env:ANIDL_SELF) -ErrorAction Stop
} catch {
  Write-Host "Could not open the folder: $($_.Exception.Message)"
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}

$tab = [string][char]9
# #U = recorded rename, #M = mapping new name -> downloader name for the whole season
$all = [System.IO.File]::ReadAllLines($env:ANIDL_SELF, (New-Object System.Text.UTF8Encoding($false)))
$entries = @($all | Where-Object { $_.StartsWith('#U' + $tab) })
$maps = @($all | Where-Object { $_.StartsWith('#M' + $tab) })
[array]::Reverse($entries)

$n = 0
$s = 0

# 1) Recorded renames, newest first
foreach ($line in $entries) {
  $parts = $line.Substring(3).Split([char]9)
  if ($parts.Count -lt 2) { continue }
  $now = $parts[0]
  $old = $parts[1]
  if (-not (Test-Path -LiteralPath $now)) { continue }
  $dir = Split-Path -Parent $now
  if ($dir) { $target = Join-Path $dir $old } else { $target = $old }
  if (Test-Path -LiteralPath $target) {
    Write-Host "Skipped, already exists: $target"
    $s++
    continue
  }
  try {
    Rename-Item -LiteralPath $now -NewName $old -ErrorAction Stop
    Write-Host "  $now -> $old"
    $n++
  } catch {
    Write-Host "Failed: $now ($($_.Exception.Message))"
    $s++
  }
}

# 2) Rename remaining files with a new name back using the season mapping
if ($maps.Count -gt 0) {
  $exts = '.mkv', '.mp4', '.webm', '.avi', '.m4v'
  $files = @(Get-ChildItem -LiteralPath . -Recurse -File | Where-Object { $exts -contains $_.Extension.ToLower() })
  foreach ($line in $maps) {
    $parts = $line.Substring(3).Split([char]9)
    if ($parts.Count -lt 3) { continue }
    $key = $parts[0]
    $new = $parts[1]
    $oldBase = $parts[2]
    $hits = @($files | Where-Object { $_.BaseName -eq $new })
    if ($key) {
      $pref = @($hits | Where-Object { ($_.FullName.ToLower() -replace '[^a-z0-9]', '').Contains($key) })
      if ($pref.Count -gt 0) { $hits = $pref }
    }
    foreach ($f in $hits) {
      if (-not (Test-Path -LiteralPath $f.FullName)) { continue }
      $oldName = $oldBase + $f.Extension
      $target = Join-Path $f.DirectoryName $oldName
      if (Test-Path -LiteralPath $target) {
        Write-Host "Skipped, already exists: $target"
        $s++
        continue
      }
      try {
        Rename-Item -LiteralPath $f.FullName -NewName $oldName -ErrorAction Stop
        Write-Host "  $($f.Name) -> $oldName"
        $n++
      } catch {
        Write-Host "Failed: $($f.FullName) ($($_.Exception.Message))"
        $s++
      }
    }
  }
}

if ($n -eq 0 -and $s -eq 0) {
  Write-Host 'Nothing to rename back.'
} else {
  Write-Host "Done: $n renamed back, $s skipped."
}
Read-Host 'Press Enter to close' | Out-Null
exit

# Data (appended automatically):
'@

$utf8 = New-Object System.Text.UTF8Encoding($false)
$tab = [string][char]9
# ProviderPath instead of Get-Location, otherwise network paths (\\\\server\\...) don't work
$root = (Get-Location).ProviderPath
$undo = Join-Path $root 'undo-rename.cmd'
$legacy = Join-Path $root 'undo-umbenennen.cmd'
$undoOk = $true
try {
  # Create it, or update an older version / take over the old German undo file (entries are kept)
  $oldData = New-Object System.Collections.Generic.List[string]
  $current = $false
  foreach ($path in @($legacy, $undo)) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $existing = [System.IO.File]::ReadAllLines($path, $utf8)
    if ($path -eq $undo) { $current = $existing -contains '# anidl-undo v3' }
    foreach ($l in $existing) {
      if (($l.StartsWith('#U' + $tab) -or $l.StartsWith('#M' + $tab)) -and -not $oldData.Contains($l)) { $oldData.Add($l) }
    }
  }
  $hasLegacy = Test-Path -LiteralPath $legacy
  if (-not $current -or $hasLegacy) {
    $lines = @($CmdHeader) + @($UndoBody.Replace([string][char]13, '').Split([char]10)) + @($oldData)
    [System.IO.File]::WriteAllLines($undo, [string[]]$lines, $utf8)
    if ($hasLegacy) { Remove-Item -LiteralPath $legacy -ErrorAction SilentlyContinue }
  }

  # Record the mapping for the whole season, even if nothing gets renamed
  $have = @{}
  foreach ($l in [System.IO.File]::ReadAllLines($undo, $utf8)) { $have[$l] = $true }
  $add = New-Object System.Collections.Generic.List[string]
  foreach ($e in $Episodes) {
    $line = '#M' + $tab + $SeriesKey + $tab + $e.New + $tab + $e.Old
    if (-not $have.ContainsKey($line)) { $add.Add($line); $have[$line] = $true }
  }
  if ($add.Count -gt 0) { [System.IO.File]::AppendAllLines($undo, [string[]]$add, $utf8) }
} catch {
  $undoOk = $false
  Write-Host "Could not create the undo file: $($_.Exception.Message)"
}

$exts = '.mkv', '.mp4', '.webm', '.avi', '.m4v'
$files = @(Get-ChildItem -LiteralPath . -Recurse -File | Where-Object { $exts -contains $_.Extension.ToLower() })

function Get-Key([string]$s) { $s.ToLower() -replace '[^a-z0-9]', '' }

$plan = New-Object System.Collections.Generic.List[object]
$taken = @{}

foreach ($e in $Episodes) {
  $re = "S0*$($Season)E0*$($e.Ep)(?!\\d)"
  $m = @($files | Where-Object { $_.Name -match $re })

  # Prefer files whose path contains the series name
  if ($SeriesKey -and $m.Count -gt 0) {
    $p = @($m | Where-Object { (Get-Key $_.FullName).Contains($SeriesKey) })
    if ($p.Count -gt 0) { $m = $p }
  }

  if ($m.Count -eq 0) {
    Write-Host "Not found: episode $($e.Ep)"
    continue
  }

  foreach ($f in $m) {
    $newName = $e.New + $f.Extension
    if ($f.Name -ceq $newName) { continue }
    $dst = Join-Path $f.DirectoryName $newName
    if ((Test-Path -LiteralPath $dst) -or $taken.ContainsKey($dst.ToLower())) {
      Write-Host "Skipped, target already exists: $dst"
      continue
    }
    $taken[$dst.ToLower()] = $true
    $plan.Add([pscustomobject]@{ Src = $f.FullName; Dst = $dst; OldName = $f.Name; NewName = $newName })
  }
}

if ($plan.Count -eq 0) {
  Write-Host ""
  Write-Host "Nothing to rename."
  Read-Host "Press Enter to close" | Out-Null
  exit
}

Write-Host ""
Write-Host "Preview ($($plan.Count) files):"
foreach ($p in $plan) {
  Write-Host "  $($p.Src)"
  Write-Host "    -> $($p.NewName)"
}
Write-Host ""
$answer = Read-Host "Rename now? [y/N]"
if ($answer -notmatch '^[yj]') {
  Write-Host "Cancelled, nothing changed."
  Read-Host "Press Enter to close" | Out-Null
  exit
}

$known = @{}
if ($undoOk) {
  foreach ($l in [System.IO.File]::ReadAllLines($undo, $utf8)) { $known[$l] = $true }
}
$ok = 0
foreach ($p in $plan) {
  try {
    Rename-Item -LiteralPath $p.Src -NewName $p.NewName -ErrorAction Stop
    $ok++
  } catch {
    Write-Host "Failed: $($p.Src) ($($_.Exception.Message))"
    continue
  }
  if (-not $undoOk) { continue }
  # Store the path relative to the folder, so undo also works with a different drive letter
  $rel = $p.Dst
  if ($rel.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { $rel = $rel.Substring($root.Length).TrimStart('\\') }
  $line = '#U' + $tab + $rel + $tab + $p.OldName
  if (-not $known.ContainsKey($line)) {
    try {
      [System.IO.File]::AppendAllLines($undo, [string[]]@($line), $utf8)
      $known[$line] = $true
    } catch {
      $undoOk = $false
      Write-Host "Could not update the undo file: $($_.Exception.Message)"
    }
  }
}

Write-Host "Done: $ok of $($plan.Count) files renamed."
if ($undoOk) {
  Write-Host "To undo: double-click undo-rename.cmd"
} else {
  Write-Host "To undo, rename these files back:"
  foreach ($p in $plan) { Write-Host "  $($p.NewName)  ->  $($p.OldName)" }
}
Read-Host "Press Enter to close" | Out-Null
`;

  return (CMD_HEADER.join("\n") + "\n" + ps).replace(/\r?\n/g, "\r\n");
}

function generateScript(platform, info, entries, fileName) {
  if (platform === "windows") return generateCmd(info, entries, fileName);
  return generateSh(info, entries, fileName, platform);
}

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

function cleanLabel(text) {
  return String(text)
    .replace(/[▶►]/g, "")
    .replace(/\(\d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readSeason(section) {
  const labelEl = section.querySelector(".season-label");
  const label = cleanLabel(labelEl ? labelEl.textContent : "");
  const number = label.match(/\d+/);
  const isExtras = /movie|film|extra|special/i.test(label) || !number;
  const seasonNumber = isExtras ? 0 : parseInt(number[0], 10);

  const episodes = [...section.querySelectorAll(".episode-item")].map((item) => {
    const numText = (item.querySelector(".ep-num") || {}).textContent || "";
    const titleEl = item.querySelector(".ep-title:not(.ep-title-missing)");
    return {
      numberText: numText.trim(),
      number: parseInt((numText.match(/\d+/) || ["0"])[0], 10),
      title: titleEl ? titleEl.textContent.trim() : "",
    };
  });

  const seriesEl = document.getElementById("seriesTitle");
  const yearEl = document.getElementById("seriesYear");
  return {
    series: seriesEl ? seriesEl.textContent.trim() : "Unknown",
    year: yearEl ? yearEl.textContent.trim() : "",
    label: label || (isExtras ? "Extras" : `Season ${seasonNumber}`),
    seasonNumber,
    isExtras,
    episodes,
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function getSettings() {
  return {
    extrasFormat: GM_getValue("extrasFormat", DEFAULTS.extrasFormat),
    seasonFormat: GM_getValue("seasonFormat", DEFAULTS.seasonFormat),
    lastPlatform: GM_getValue("lastPlatform", "windows"),
  };
}

const BUTTON_TEXT = "📜 Rename ▾";

function registerMenu() {
  GM_registerMenuCommand("Name format for movies/extras", () => {
    const value = prompt(
      "Format for movies/extras.\nPlaceholders: {series} {year} {season} {episode} {title}",
      getSettings().extrasFormat
    );
    if (value !== null && value.trim()) GM_setValue("extrasFormat", value.trim());
  });
  GM_registerMenuCommand("Name format for seasons", () => {
    const value = prompt(
      "Format for regular seasons.\nPlaceholders: {series} {year} {season} {episode} {title}",
      getSettings().seasonFormat
    );
    if (value !== null && value.trim()) GM_setValue("seasonFormat", value.trim());
  });
  GM_registerMenuCommand("Reset name formats", () => {
    Object.entries(DEFAULTS).forEach(([key, value]) => GM_setValue(key, value));
    alert("Name formats have been reset.");
  });
}

function addStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .anidl-rename-btn {
      margin-left: auto;
      margin-right: 10px;
      padding: 3px 10px;
      font: inherit;
      font-size: 0.85em;
      border-radius: 6px;
      border: 1px solid rgba(127, 127, 127, 0.5);
      background: rgba(127, 127, 127, 0.15);
      color: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .anidl-rename-btn:hover { background: rgba(127, 127, 127, 0.3); }
    .anidl-rename-btn:disabled { opacity: 0.6; cursor: wait; }
    .anidl-rename-menu {
      position: fixed;
      z-index: 99999;
      min-width: 220px;
      padding: 4px;
      border-radius: 8px;
      border: 1px solid rgba(127, 127, 127, 0.5);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      font-size: 14px;
    }
    .anidl-rename-menu button {
      display: flex;
      width: 100%;
      justify-content: space-between;
      gap: 16px;
      padding: 7px 10px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .anidl-rename-menu button:hover,
    .anidl-rename-menu button:focus { background: rgba(127, 127, 127, 0.25); outline: none; }
    .anidl-rename-menu .hint { opacity: 0.65; font-size: 0.9em; }
    .anidl-rename-menu .last { font-weight: 600; }
  `;
  document.head.appendChild(style);
}

let openMenu = null;

function closeMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  document.removeEventListener("mousedown", onOutsideClick, true);
  document.removeEventListener("keydown", onMenuKey, true);
}

function onOutsideClick(event) {
  if (!openMenu || openMenu.contains(event.target)) return;
  // A click on the menu's own button is handled by the button itself (toggle)
  if (openMenu.anchor && openMenu.anchor.contains(event.target)) return;
  closeMenu();
}

function onMenuKey(event) {
  if (event.key === "Escape") closeMenu();
}

/** Take the page background colour so the menu matches the theme. */
function menuColors() {
  let node = document.body;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) {
      return { bg, fg: getComputedStyle(document.body).color };
    }
    node = node.parentElement;
  }
  return { bg: "#222", fg: "#eee" };
}

function showPlatformMenu(btn, onPick) {
  closeMenu();
  const last = getSettings().lastPlatform;
  const menu = document.createElement("div");
  menu.className = "anidl-rename-menu";
  const colors = menuColors();
  menu.style.background = colors.bg;
  menu.style.color = colors.fg;

  PLATFORMS.forEach((platform) => {
    const item = document.createElement("button");
    item.type = "button";
    if (platform.id === last) item.classList.add("last");
    item.innerHTML = `<span></span><span class="hint"></span>`;
    item.children[0].textContent = platform.label;
    item.children[1].textContent = platform.hint;
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      GM_setValue("lastPlatform", platform.id);
      onPick(platform);
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  const rect = btn.getBoundingClientRect();
  const width = menu.offsetWidth;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  menu.anchor = btn;
  openMenu = menu;
  document.addEventListener("mousedown", onOutsideClick, true);
  document.addEventListener("keydown", onMenuKey, true);
  const focus = menu.querySelector(".last") || menu.querySelector("button");
  if (focus) focus.focus();
}

function waitFor(check, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const result = check();
      if (result) return resolve(result);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 250);
    };
    tick();
  });
}

function downloadText(fileName, text) {
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function createScript(section, btn, platform) {
  const body = section.querySelector(".season-body");
  const header = section.querySelector(".season-header");
  if (!body) return;

  // Episodes are only loaded when the season is expanded
  if (!body.querySelector(".episode-item")) {
    if (!body.classList.contains("expanded") && header) header.click();
    btn.disabled = true;
    btn.textContent = "⏳ Loading episodes…";
    const found = await waitFor(() => body.querySelector(".episode-item"), 30000);
    btn.disabled = false;
    btn.textContent = BUTTON_TEXT;
    if (!found) {
      alert("Could not load the episodes of this season.");
      return;
    }
  }

  const info = readSeason(section);
  if (info.episodes.some((ep) => /^P/i.test(ep.numberText))) {
    alert("Manga is not supported.");
    return;
  }

  const entries = buildEntries(info, getSettings());
  if (!entries.length) {
    alert("There are no episode titles for this season.");
    return;
  }

  const fileName = `${sanitizeName(`rename - ${info.series} - ${info.label}`)}.${platform.ext}`;
  downloadText(fileName, generateScript(platform.id, info, entries, fileName));
}

function addButtons() {
  document.querySelectorAll(".season-section").forEach((section) => {
    const header = section.querySelector(".season-header");
    if (!header || header.querySelector(".anidl-rename-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "anidl-rename-btn";
    btn.textContent = BUTTON_TEXT;
    btn.title = "Download a script that renames this season's files with their real episode titles";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation(); // otherwise the season expands/collapses
      if (openMenu) {
        const sameButton = openMenu.anchor === btn;
        closeMenu();
        if (sameButton) return;
      }
      showPlatformMenu(btn, (platform) => createScript(section, btn, platform));
    });

    const checkbox = header.querySelector(".checkbox");
    header.insertBefore(btn, checkbox || null);
  });
}

/**
 * The web UI can run on any address (IP, port, own domain), so the script runs everywhere
 * and only becomes active on pages that are really the AniWorld Downloader web UI.
 * Every page of the UI has <meta name="application-name" content="AniWorld Downloader">
 * and loads /static/common.js.
 */
function isDownloaderUI(doc) {
  const meta = doc.querySelector('meta[name="application-name"]');
  if (!meta || meta.getAttribute("content") !== "AniWorld Downloader") return false;
  return [...doc.querySelectorAll("script[src]")].some((script) =>
    /\/static\/common\.js(\?|$)/.test(script.getAttribute("src"))
  );
}

function init() {
  if (!isDownloaderUI(document)) return;
  addStyles();
  registerMenu();
  addButtons();
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      addButtons();
    });
  }).observe(document.body, { childList: true, subtree: true });
}

if (typeof module !== "undefined" && module.exports) {
  // Only for tests with Node
  module.exports = {
    sanitizeName,
    formatName,
    seriesKey,
    buildEntries,
    generateSh,
    generateCmd,
    generateScript,
    cleanLabel,
    isDownloaderUI,
    DEFAULTS,
  };
} else {
  init();
}
