# StackSettler - Poker Tracker

All data is stored locally on the device (browser localStorage). No account or internet needed.

## Get an APK without installing anything (GitHub builds it for you)
1. Create a free account at github.com and make a new repository (e.g. "poker-tracker").
2. Upload everything in this folder to it (Add file > Upload files).
   Make sure the `.github/workflows/build-apk.yml` file gets uploaded too. If your
   computer hides it, use Add file > Create new file, type the name
   `.github/workflows/build-apk.yml`, and paste in the contents.
3. Open the repo's "Actions" tab > "Build Android APK" > "Run workflow".
4. After ~5-10 minutes, open the finished run and download "StackSettler-apk" at the bottom.
   Unzip it to get app-debug.apk, copy it to your phone and install it
   (allow "install from unknown sources" when prompted).

## Run on your computer (optional, needs Node.js)
    npm install
    npm run dev

## Build locally with Android Studio (optional)
    npm install
    npm run build
    npm run cap:add
    npm run cap:sync
    npm run cap:open

## Moving your data from an older app version
This build has a new app ID, so it installs NEXT TO the old app instead of replacing it. Nothing is lost.
1. In the OLD app: More > Settings & backup > Backup (JSON). Copy the text (or save the file).
2. In the NEW app: More > Settings & backup > Restore, choose the file or paste the text, then Restore.
3. Check your games, then uninstall the old app.
Apps cannot read each other's data, so the backup text is how it moves across.
If the old app has no Settings & backup page, it can't export; see the notes in the chat for options.

## Updating the app without losing data
The workflow signs every build with the same key (`signing/debug.keystore`), so a new APK installs
over the old one and keeps your games. Make sure the `signing` folder is uploaded to GitHub too.
(The very first time you switch to this key, Android asks you to uninstall the old app first.
Use Settings > Backup beforehand if your old version has it.)

This is a debug key that anyone with the repo can see, which is fine for sideloading to your own
phone but is not suitable for publishing on the Play Store.

## Features
- Live sessions, buy-ins, cash-outs and automatic settlement plans
- Edit any game's settlement plan, mark each payment paid per game, or record custom payments in the Ledger
- Edit finished game results, add game notes
- Rankings with period filters, player stats and graphs
- Currency and rounding settings, backup and restore (JSON), CSV export, share settlements
