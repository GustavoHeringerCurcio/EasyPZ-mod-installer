# Alpha guide

## What testers receive

Build the app, then share the installer directly:

- `release/EasyPZ-0.1.0-alpha.1-setup.exe` (recommended for non-technical testers)
- `release/EasyPZ-0.1.0-alpha.1-portable.exe` (single file, no installation)
- `release/EasyPZ-0.1.0-alpha.1-x64.zip` (portable folder; extract everything first)

The ZIP and installed app include `START-HERE.txt` with the same steps as this guide. The catalog is fetched from the public `EasyPZ-assets` repository, with a bundled fallback for offline use. Mod archives and Workshop items are downloaded from their public sources, so no token is needed.

## Sharing a build

1. Run `pnpm package:win`.
2. Choose one file:
   - **Non-technical tester:** send `EasyPZ-<version>-setup.exe`.
   - **No-install tester:** send `EasyPZ-<version>-portable.exe`.
   - **ZIP requested:** send `EasyPZ-<version>-x64.zip` and tell the tester to extract the whole archive first.
3. Publish the files as a release in `EasyPZ-assets` and send the release asset link.
4. Send the SHA256 from `Get-FileHash <file> -Algorithm SHA256`.
5. Tell the tester to close Project Zomboid before installing a pack.

## SmartScreen

Builds are unsigned. Windows may show "Windows protected your PC".

1. Click **More info**.
2. Click **Run anyway**.

Publish the SHA256 checksum with every build so testers can verify the file.

## What to test

### Fresh install

1. Close Project Zomboid.
2. Run the installer and launch EasyPZ.
3. Confirm the catalog shows Medium and Advanced with artwork and mod counts.
4. Open a pack, check the tabs, then install it.
5. Watch preflight, download, verify, extract, apply, ZombieBuddy, configure, activate, host.
6. Launch the game and confirm the mods load.

### Existing legacy install

1. Run EasyPZ on a PC that used the old `.bat` installer.
2. Confirm the library shows the old profile as installed/active.
3. Install or repair and confirm the old archive cache is reused when the hash matches.
4. Confirm `%USERPROFILE%\Zomboid\EasyPZ\state.json` exists.

### Toggling and switching packs

1. Install Advanced. The card switch turns on.
2. Turn Advanced off. Its folders move to `Zomboid\EasyPZ\store`; `Zomboid\mods` keeps only unmanaged folders.
3. Turn Medium on. Advanced moves to the store and Medium moves into `Zomboid\mods`.
4. Confirm only one switch is on and only one pack’s folders are in `Zomboid\mods`.
5. Confirm unrelated IDs in `default.txt` are preserved.

### Failure cases

- Launch the game, then try to install. Expect a "close the game" error.
- Cancel during download. Expect a cancelled install and a resumable `.part` file.
- Use a machine where PZ is in `Program Files`. Expect the administrator prompt at install time.
- Remove `servertest.ini`. Host setup should skip without failing the install.

## Logs and reports

- In-app: **Logs** page and the live log in the install dialog.
- File: `%LOCALAPPDATA%\EasyPZ\logs\main.log`.
- State: `%USERPROFILE%\Zomboid\EasyPZ\state.json`.
- Backups: `%USERPROFILE%\Zomboid\backups`.

When reporting a bug, include:

- Windows version
- Whether PZ is in `Program Files`
- Pack and app version
- The log file
- Whether the game was running
- Whether a legacy install was present

## Known alpha limitations

- The catalog is fetched remotely with a bundled fallback. App updates are manual; the portable build does not self-update.
- Builds are unsigned.
- ZombieBuddy’s official interactive installer is not launched; the app uses the manual jar/DLL path and warns when files are missing.
- Steam detection is best-effort; use **Settings → Change folder** if needed.
- Artwork is placeholder.
- English and Portuguese are the only languages.

## Cleanup

Uninstalling EasyPZ does not delete mods, saves, or backups. Use the Library page to deactivate or purge a pack first if desired.
