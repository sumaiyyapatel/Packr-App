# Packr — Sudoku Travel Packing App (PRD)

## What it is
Mobile app (React Native + Expo + TypeScript) that helps travellers pack smarter using the **Sudoku method**: 9 garments (3 tops, 3 bottoms, 3 layers) arranged in a 3×3 grid generate **27 unique outfit combinations** with an efficiency ratio of 3.0.

## Stack
- **Frontend**: Expo Router, TypeScript, Zustand (store), AsyncStorage (token + onboarding flag), expo-image-picker (photos), expo-haptics (grid snap), @expo/vector-icons (Ionicons), react-native-safe-area-context, react-native-gesture-handler
- **Backend**: FastAPI + Motor (MongoDB), JWT (PyJWT) + bcrypt auth
- **Weather**: Open-Meteo (free, no API key) — `/api/geocode` for city search + `/api/weather` for 14-day forecast

## Screens
1. **Auth** — Login + Register (email/password, JWT token persisted in AsyncStorage)
2. **Onboarding · Method explainer** — "9 items. 27 outfits." with mini grid + stats
3. **Onboarding · Trip create** — Destination autocomplete (geocode), start/end dates
4. **Tab · Home (Dashboard)** — Trip cards (countdown, weather, packing progress), stats (outfits/items/efficiency ratio), wardrobe summary, theme toggle, logout
5. **Tab · Studio** — Wardrobe library, add items via camera/library, category Top/Bottom/Layer, weight, tags, color swatches
6. **Tab · Grid** — 3×3 builder. Tap empty slot → tap matching-category wardrobe item to fill. Tap filled slot to remove. Conflict checker (wrong category, opposite tags). "Generate 27 Outfits" enabled only when 9/9 valid
7. **Tab · Lookbook** — 27 outfit cards (top/bottom/layer + occasion tag), heart favorites, occasion editor, filter chips (All/Favorites/Casual/Formal/Travel/Active/Modest)
8. **Tab · Pack (Checklist)** — Grid items + essentials with checkboxes & weights. Sticky weight bar showing kg vs 7kg carry-on limit (warning when over). Add custom essentials.

## API surface (all under `/api`)
- Auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- Wardrobe: `GET /wardrobe`, `POST /wardrobe`, `DELETE /wardrobe/{id}` (also nulls grid slots)
- Trips: `GET /trips`, `POST /trips`, `GET /trips/{id}`, `DELETE /trips/{id}`, `PUT /trips/{id}/grid`, `PUT /trips/{id}/favorite`, `PUT /trips/{id}/occasion`, `PUT /trips/{id}/checklist`, `POST /trips/{id}/extras`, `DELETE /trips/{id}/extras/{eid}`
- Open-Meteo proxy: `GET /geocode?q=`, `GET /weather?latitude=&longitude=`

## Sudoku math
- Grid layout: column 0 = TOP, column 1 = BOTTOM, column 2 = LAYER (3 of each by row)
- Outfit = (top_i, bottom_j, layer_k) for i,j,k ∈ {0,1,2} → 3³ = 27 unique outfits

## Design system (Linear Look + Teenage Engineering)
- True black `#000` dark default; `#FFF` light mode
- Sage green accent `#8DA399` (dark) / `#6A8276` (light)
- Inter/system sans-serif; mono for numerics
- 8pt grid spacing, 1px borders, 4-8px radius, glassmorphism backdrops on modals
- Haptic snap on grid fill, selection feedback on slot focus, success haptic on outfit generation

## Test credentials
See `/app/memory/test_credentials.md` (test@packr.app / test1234)

## Future (Phase 2)
- AI background removal (Gemini Nano Banana, paid via user's own LLM key — commission model)
- Color palette extraction from real photos
- Community grid templates ("7 Days in Tokyo — Autumn Minimalist")
- Weather-fit warnings against grid (climate compatibility)
- Live drag-and-drop with react-native-reanimated gesture interactions
