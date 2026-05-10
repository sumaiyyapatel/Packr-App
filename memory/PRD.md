# Packr — Sudoku Travel Packing App (PRD)

## What it is
Mobile app (React Native + Expo + TypeScript) that helps travellers pack smarter using the **Sudoku method**: 9 garments (3 tops, 3 bottoms, 3 layers) arranged in a 3×3 grid generate **27 unique outfit combinations** with an efficiency ratio of 3.0.

## Stack
- **Frontend**: Expo Router, TypeScript, Zustand (store), AsyncStorage, expo-image-picker, expo-haptics, react-native-gesture-handler + react-native-reanimated (drag-and-drop), @expo/vector-icons
- **Backend**: FastAPI + Motor (MongoDB), JWT (PyJWT) + bcrypt auth, Pillow (palette + DOS guard)
- **Weather**: Open-Meteo (free, no API key)

## Tiers
- **Free**: Up to 2 trips, full Sudoku grid + 27 outfits + Lookbook + Pack, browse community templates, 1 hardcoded carry-on profile.
- **Pro (₹199/mo or ₹1499/yr)**: Unlimited trips, publish community templates, custom airline weight profiles, Phase-2 AI conflict suggestions and on-device Gemini Nano cutouts.

## Screens
1. **Auth** — Login + Register (JWT in AsyncStorage)
2. **Onboarding · Method explainer** — "9 items. 27 outfits."
3. **Onboarding · Trip create** — Open-Meteo geocode autocomplete + dates. Free-tier 402 surfaced inline.
4. **Tab · Home (Dashboard)** — Trips, weather, climate-fit banner, stats, wardrobe summary, **PRO badge / GO PRO** button, theme toggle, Templates entry
5. **Tab · Studio** — Wardrobe library; photo-based palette extraction (Pillow median-cut)
6. **Tab · Grid** — Real long-press + drag-and-drop (gesture-handler + reanimated). Drop on matching-category slot fills it. Conflict checker.
7. **Tab · Lookbook** — 27 outfit cards, favorite + occasion tags, filter chips
8. **Tab · Pack (Checklist)** — **Airline weight-profile picker** drives carry-on threshold. Grid items + essentials + extras with weight totals.
9. **Stack · Templates** — Browse 4 official community templates, like (idempotent per user), apply (cleans up prior `from-template` clones).
10. **Stack · Pro** — Tier comparison, demo upgrade/downgrade (no real billing), airline profile manager.

## API surface (all under `/api`)
- Auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me` (auto-backfills default airline profiles)
- Wardrobe: `GET/POST /wardrobe`, `DELETE /wardrobe/{id}`
- Trips: `GET/POST /trips` (free cap 2), `GET/DELETE /trips/{id}`, `PUT /trips/{id}/grid|favorite|occasion|checklist`, `POST/DELETE /trips/{id}/extras`
- Open-Meteo proxy: `GET /geocode`, `GET /weather`
- Color palette: `POST /palette` — Pillow + 4 MB / 24 MP guard (decompression-bomb safe)
- Templates: `GET /templates`, `GET /templates/{id}`, `POST /templates` (Pro only), `POST /templates/{id}/like`, `DELETE /templates/{id}/like` (per-user idempotent via unique compound index `(template_id, user_id)`), `POST /templates/{id}/apply` (cleans up prior from-template clones)
- Pro / Me: `POST/DELETE /me/pro`, `POST /me/airlines` (Pro only), `DELETE /me/airlines/{id}`

## Test credentials
See `/app/memory/test_credentials.md` (test@packr.app / test1234, currently is_pro=true).

## Future
- AI background removal: Remove.bg free tier (50/mo) or Gemini Nano on-device for Pro
- Stripe / Razorpay billing wiring for /me/pro
- AI-powered grid conflict suggestions
- Server.py code-split into routers/ as it grows past ~700 lines
