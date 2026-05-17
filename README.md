# Packr

Expo mobile app with a FastAPI backend for Sudoku-style travel packing.

## Local Setup

Backend:

```bash
cd backend
uvicorn server:app --reload --host 0.0.0.0 --port 8000
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
