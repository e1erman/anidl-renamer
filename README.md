# anidl-renamer

Tampermonkey script for the AniWorld Downloader web UI. It adds a **📜 Rename ▾** button to
every season (including "Movies"). Click it, pick your system, and a script is downloaded that
renames that season's files with their real episode titles.

The userscript only reads the titles the web UI already shows. It doesn't download anything
and doesn't change the downloader.

## Install

1. Install Tampermonkey in your browser.
2. Tampermonkey → *Create a new script* → paste the contents of `anidl-renamer.user.js` → save.
3. Reload the web UI.

It works on any address the web UI runs on: a local IP and port, `localhost`, your own domain,
behind a reverse proxy or a login like Cloudflare Access. Nothing needs to be configured.
The script is loaded on every site, but it only becomes active when the page is the
AniWorld Downloader web UI (it checks for `<meta name="application-name" content="AniWorld Downloader">`
and `/static/common.js`). On all other sites it does nothing.

Tampermonkey shows that the script "runs on all sites" because of this. If you prefer, you can
limit it in Tampermonkey: script → *Settings* → untick *Original matches* and add your address(es)
under *User matches*, e.g. `http://192.168.1.10:39571/*` and `https://aniworld-downloader.example.com/*`.

## Usage

1. Open a series in the web UI.
2. Click **📜 Rename ▾** on the season you want and pick your system.
   If the season is still collapsed, it is expanded automatically.
3. Put the downloaded script into the series folder and start it:

| System | File | Start |
|---|---|---|
| Windows | `.cmd` | Double-click |
| Linux / NAS | `.sh` | `bash "rename - ….sh"` |
| macOS | `.command` | once `chmod +x "rename - ….command"`, then double-click (the first time: right-click → *Open*). Or `bash "rename - ….command"` |

4. The script shows a preview and asks before renaming anything.

### Undo

There is always **one** undo file next to the script: `undo-rename.cmd` (Windows, double-click)
or `undo-rename.sh` (Linux/macOS, `bash undo-rename.sh`).

- It is created every time the script runs, even if nothing was renamed or you cancelled.
- It contains the mapping for **the whole season** (new name → original name), not just for the
  episodes that were just renamed. So it can also rename back files that were renamed earlier,
  with an older version, or by hand.
- The original name is the downloader's default name: `<Series> S00E001`.
  If a file was renamed by this script, its real old name is used instead.
- Every further season and every further run in the same folder is appended to the same file.
- Only files that still exist are renamed back. Deleted or already reverted files are simply
  skipped, so you can run it as often as you like.
- An undo file from an older version (including the old `undo-umbenennen` file) is updated
  automatically the next time the script runs. All its entries are kept.

### Warnings when downloading

Browsers and Windows often warn about downloaded `.cmd` files ("This file may be harmful",
SmartScreen "Windows protected your PC"). That is normal for generated scripts: choose *Keep*,
or *More info → Run anyway*. If you want to be sure, open the file in a text editor first.
It is plain text.

### "UNC paths are not supported"

When you start the `.cmd` from a network path like `\\server\share\...`, Windows shows this
message. It is harmless: the script switches to the right folder by itself. To get rid of it,
map the share as a network drive (e.g. `Z:`) and open the folder from there.

## Name formats (Tampermonkey menu)

Click the Tampermonkey icon while the web UI is open:

- **Name format for movies/extras**: default `{series} - {title}`
- **Name format for seasons**: default `{series} S{season}E{episode} - {title}`

Placeholders: `{series}` `{year}` `{season}` `{episode}` `{title}`

## How files are found

- The script searches its own folder and all subfolders for video files
  (`.mkv .mp4 .webm .avi .m4v`) with `S<season>E<episode>` in the name, e.g. `S00E001`.
  The number of zeros doesn't matter, but `E1` is never confused with `E10`.
- If some matches have the series name in their path, only those are used.
  Still, it's best to run it in the series folder, not in the whole library.
- If the new name already exists, the file is skipped.
- Episodes without a title in the web UI are not renamed.
- The Linux/macOS version also runs on the old Bash 3.2 that ships with macOS.

## License

[MIT](LICENSE)
