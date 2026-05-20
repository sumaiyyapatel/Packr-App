# Packr

Expo mobile app with a FastAPI backend for Sudoku-style travel packing.

## Local Setup

Backend:

```bash
cd backend
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

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

Frontend:

```bash
cd frontend
npm install
npm start
```

Android development build:

```powershell
cd E:\packr\frontend
npm run dev:health
npm run dev:android
```

Expo Go email/password testing:

```powershell
cd E:\packr\frontend
npm run dev:android:expo-go
```

Android details: [frontend/ANDROID_SETUP.md](frontend/ANDROID_SETUP.md)
