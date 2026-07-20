# Packr → Firebase (Auth + Firestore) migration plan

Project: **inkspace711** (project number 907161342594) — Android app `com.inkspace.packr` already registered; `frontend/google-services.json` is current.

## Your console checklist (one-time, ~5 minutes)
1. [console.firebase.google.com](https://console.firebase.google.com) → **inkspace711** → **Build → Firestore Database → Create database** (production mode, pick a region close to your users — e.g. `asia-south1`).
2. **Build → Authentication → Sign-in method**: confirm **Email/Password** and **Google** are enabled (they likely already are, since sign-in works today).
3. Later, Phase 3: **Build → Storage → Get started** (needs the Blaze plan for meaningful usage).
4. Deploy rules once Firestore exists: `npx firebase-tools deploy --only firestore` from `E:\packr` (login with `npx firebase-tools login` first).

## What's already done (this session)
- `firebase.json`, `firestore.rules`, `firestore.indexes.json` at repo root — owner-only access to user data, public-read templates, community rules pre-written, `is_pro` locked against client tampering.
- `frontend/src/lib/firebase.ts` — shared app + Firestore init (RN long-polling safe).
- `frontend/src/lib/firestoreRepo.ts` — full data layer for **users, wardrobe, trips** including grid validation, checklist/favorite/occasion/outfit-plan updates, and the grid-cleanup logic ported from `server.py`.

## Data model
```
users/{uid}                    profile, airline_profiles, is_pro
users/{uid}/wardrobe/{id}      name, category, image, colors, weight_kg, tags
users/{uid}/trips/{id}         destination, dates, lat/lon, grid[9],
                               favorites, occasion_tags, checklist_state,
                               extras, outfit_plan
users/{uid}/trips/{id}/reflections/{id}
templates/{id}                 official + community (public read)
posts/{id} (+likes/saves/comments subcollections), follows/{a_b}   ← Phase 3
```

## Endpoint → replacement map

| Current API | Replacement | Phase |
|---|---|---|
| `/auth/*` | Firebase Auth only (already built in `firebaseAuth.ts`); `ensureUserDoc()` replaces `/auth/me` | 1 |
| `/wardrobe` CRUD | `firestoreRepo` (done) | 1 |
| `/trips` CRUD, grid, checklist, favorite, occasion, outfit-plan, extras | `firestoreRepo` (done) | 1 |
| `/trips/{id}/stats` | port `compute_trip_stats` to a client util (pure math) | 2 |
| `/trips/{id}/outfit-suggestions` | port `score_outfit` client-side; feed it live Open-Meteo data | 2 |
| `/weather`, `/geocode` | call Open-Meteo **directly from the app** (no key, CORS-friendly) — deletes the proxy | 2 |
| `/retention/nudges` | client-side util over local trips (pure logic today) | 2 |
| `/templates` list/get/apply/like | `templates` collection; official seeded once via Admin script; apply = client clone into wardrobe | 2 |
| `/uploads/*` images | **Firebase Storage** (`wardrobe/{uid}/…`, `posts/{uid}/…`) + Storage rules | 3 |
| `/palette`, `/cutout` | palette: client-side (e.g. from image pixels); cutout: drop or Cloud Function (rembg won't run client-side) | 3 |
| `/community/*` posts/likes/saves/comments/follows | `posts` + subcollections + `follows` (rules pre-written); share image rendered client-side with `react-native-view-shot` instead of PIL | 3 |
| `/community/trending` | Cloud Function or denormalized `score` field updated on write | 3 |
| `/analytics/events`, `/feedback` | Firebase Analytics SDK / a `feedback` collection | 3 |
| `/me/pro` | RevenueCat webhook → Cloud Function sets `is_pro` (client can't, rules block it) | 4 |
| `DELETE /me` | Cloud Function (needs Admin SDK to wipe subcollections + Auth user) | 4 |

## Phase order (each leaves the app working)
1. **Core swap** — `store.ts` switches trips/wardrobe/profile to `firestoreRepo`; auth drops the legacy fallback. Screens: Dashboard, Grid, Studio, Checklist.
2. **Pure-logic ports** — stats, suggestions, nudges, weather-direct, templates. Backend now unused by the app for everything but community.
3. **Community + Storage** — posts, social edges, image uploads, client-rendered share cards. FastAPI/Mongo can be shut down after this.
4. **Server-required bits** — account deletion Function, RevenueCat webhook, template seeding script.

## Honest caveats
- **Offline wins**: Firestore's local cache gives you offline reads/writes for free — a real upgrade for a travel app.
- **You lose** server-side image processing (rembg cutout) unless you add Cloud Functions (Blaze plan). The Pillow fallback dies with the backend; plan to drop cutout or accept Functions.
- **Community queries** (trending, follower feeds) are harder in Firestore than Mongo — they need denormalized counters and composite indexes. Budget real time for Phase 3.
- Existing Mongo data: current test data can be discarded, or I can write a one-off export/import script if you have data worth keeping.
