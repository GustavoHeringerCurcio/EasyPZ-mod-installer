# Private alpha guide

## What testers receive

The repository is private, so testers do not need GitHub access. Build the app, then share the installer directly:

- `release/EasyPZ-0.1.0-alpha.0-setup.exe` (recommended)
- `release/EasyPZ-0.1.0-alpha.0-x64.zip` (portable)

The alpha catalog is bundled in the app. Mod archives are downloaded from the existing public legacy releases, so no token is needed.

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

### Switching packs

1. Install Advanced, then install Medium.
2. Confirm Advanced-only folders move to `Zomboid\backups`.
3. Confirm shared Medium folders are kept.
4. Switch back and confirm the mods return.

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

- Catalog and artwork are bundled; remote catalog and auto-update are off.
- Builds are unsigned.
- ZombieBuddy’s official interactive installer is not launched; the app uses the manual jar/DLL path and warns when files are missing.
- Steam detection is best-effort; use **Settings → Change folder** if needed.
- Artwork is placeholder.
- English and Portuguese are the only languages.

## Cleanup

Uninstalling EasyPZ does not delete mods, saves, or backups. Use the Library page to deactivate or purge a pack first if desired.
