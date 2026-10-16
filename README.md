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
