# Packr

Expo mobile app with a FastAPI backend for Sudoku-style travel packing.

## Local Setup

Backend:

```bash
cd backend
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

<<<<<<< HEAD
Backend production env:

```bash
PACKR_ENV=production
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/packr?retryWrites=true&w=majority
DB_NAME=packr
FIREBASE_PROJECT_ID=<firebase-project-id>
FIREBASE_AUTH_STRICT=1
ALLOW_LEGACY_AUTH=0
CORS_ORIGINS=https://your-app.example
```

Use `backend/.env.example` for the full Firebase Admin and MongoDB Atlas template.

Hosted backend:

```bash
# Render Blueprint reads render.yaml. Required secret env vars:
MONGODB_URI=mongodb+srv://...
FIREBASE_PROJECT_ID=...
FIREBASE_CREDENTIALS_JSON=...
```

Standalone hosted Android APK:

```powershell
cd E:\packr\frontend
$env:EXPO_PUBLIC_BACKEND_URL="https://your-backend-host.example"
npm run android:hosted-apk
```

=======
>>>>>>> 38e44c4 (Resolve merge conflicts)
Frontend:

```bash
cd frontend
npm install
npm start
```

<<<<<<< HEAD
Android development build:
=======
## Vercel Backend

Use Vercel Hobby for a no-card HTTPS backend.

Vercel settings:

- Framework Preset: FastAPI
- Root Directory: repo root, not `frontend`
- Install Command: `pip install -r requirements.txt`
- Build Command: empty/default
- Output Directory: empty

Environment variables:

```env
PACKR_ENV=production
MONGODB_URI=mongodb+srv://...
DB_NAME=packr
FIREBASE_PROJECT_ID=...
FIREBASE_AUTH_STRICT=1
ALLOW_LEGACY_AUTH=0
FIREBASE_CREDENTIALS_JSON={"type":"service_account",...}
CORS_ORIGINS=https://your-project.vercel.app
UPLOAD_DIR=/tmp/packr-uploads
```

Verify:

```powershell
curl https://your-project.vercel.app/api/health
```

If Vercel returns `NOT_FOUND`, redeploy after confirming:

- Latest commit includes `api/index.py` and `vercel.json`.
- Project root is the repo root, not `frontend`.
- Framework preset is FastAPI.

## Hosted APK

```powershell
cd E:\packr\frontend
$env:EXPO_PUBLIC_BACKEND_URL="https://your-project.vercel.app"
npm run android:hosted-apk
```

Output:

```text
E:\packr\frontend\android\app\build\outputs\apk\release\app-release.apk
```

## Android Development
>>>>>>> 38e44c4 (Resolve merge conflicts)

```powershell
cd E:\packr\frontend
npm run dev:health
npm run dev:android
```

<<<<<<< HEAD
Expo Go email/password testing:

```powershell
cd E:\packr\frontend
npm run dev:android:expo-go
```

=======
>>>>>>> 38e44c4 (Resolve merge conflicts)
Android details: [frontend/ANDROID_SETUP.md](frontend/ANDROID_SETUP.md)
