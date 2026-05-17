# Android Development Setup

Use this flow for a physical Android phone connected by USB.

## 1. Start Backend

Keep this terminal open:

```powershell
cd E:\packr\backend
uvicorn server:app --host 0.0.0.0 --port 8000
```

Check it:

```powershell
curl http://localhost:8000/api/
```

Expected:

```json
{"service":"Packr","status":"ok"}
```

## 2. Check Phone and Backend Link

In a second terminal:

```powershell
cd E:\packr\frontend
npm run dev:health
```

This checks:

- backend on `localhost:8000`
- MongoDB on `127.0.0.1:27017`
- connected Android device
- `adb reverse tcp:8000 tcp:8000`
- phone access to `http://127.0.0.1:8000/api/`

## 3. Start Android App

For the installed development build APK:

```powershell
cd E:\packr\frontend
npm run dev:android
```

For Expo Go email/password testing only:

```powershell
cd E:\packr\frontend
npm run dev:android:expo-go
```

Android Google sign-in does not work in Expo Go because it uses the native `RNGoogleSignin` module. Use the development build for Google.

## Build and Install Development APK

```powershell
cd E:\packr\frontend
npm run android:apk
npm run android:install-apk
```

The native `android/` folder is generated output and is ignored by git. `npm run android:apk` recreates it if it is missing.

If login behaves strangely after config changes:

```powershell
adb shell pm clear com.inkspace.packr
```

This clears local app data on the phone.

## Firebase Google Sign-In

Firebase must have an Android OAuth client with:

- Package name: `com.inkspace.packr`
- Debug SHA-1 from `frontend/android/app/debug.keystore`

After changing Firebase Android OAuth settings, download a fresh `google-services.json`, place it at:

```text
E:\packr\frontend\google-services.json
```

Then rebuild and reinstall the APK.

## Common Failures

`Communication not permitted by network security`

- Release builds require HTTPS and do not allow cleartext HTTP.
- Local development builds opt into cleartext only when `PACKR_ANDROID_ALLOW_CLEARTEXT=1`.
- Rebuild and reinstall the development APK after native config changes:

```powershell
cd E:\packr\frontend
npm run android:apk
npm run android:install-apk
adb shell pm clear com.inkspace.packr
```

## Release Build Notes

Production and preview EAS profiles keep `PACKR_ANDROID_ALLOW_CLEARTEXT=0`.
Set `EXPO_PUBLIC_BACKEND_URL` to an HTTPS API URL before building:

```powershell
cd E:\packr\frontend
$env:EXPO_PUBLIC_BACKEND_URL="https://api.your-domain.com"
npm run android:release
```

`Network Error`

- Backend is not running, or the app bundle has stale env values.
- Run `npm run dev:health`.
- Restart Expo with `npm run dev:android`.

`RNGoogleSignin could not be found`

- You are using Expo Go.
- Install and open the development APK, then run `npm run dev:android`.

Expo QR does not open Android app

- Use the development build QR for `npm run dev:android`.
- Use the Expo Go QR only for `npm run dev:android:expo-go`.
