# Packr — Remaining Work Roadmap
*Compiled 2026-07-22. Everything discussed but not yet shipped, in build order. Cross-references: `IMPROVEMENTS.md` (audit), `FIRESTORE_MIGRATION.md`, `DESIGN_SYSTEM.md`, `DESIGN_BRIEF.md`.*

## Already done (for context)
Security fixes (token refresh, SecureStore, rate limiting, /me/pro guard, checklist-key validation, analytics caps). Firebase migration phases 1–3 (Auth + Firestore for wardrobe/trips/templates/community; weather direct; inline images on Spark). Instagram share. Two bug fixes (day off-by-one, template publish >1 MB). Design wave 1 (tokens, fonts, upgraded `ui.tsx`, CalendarPlanner). Full Figma system (15 components, 17 screens, flow map). **Design v2 migration + Phase A (2026-07-23)** — see below.

---

## Phase A — Finish the visual rebuild (design waves 2–3) ✅ done 2026-07-23
Rolled the v2 Figma system (accent `#9FC4D6`, radii 15/25/100, DM Sans + DM Mono + Inter) across every screen. Also fixed the `lookbook.tsx` `publishTemplate` name-shadowing bug and several accent-fill text-contrast bugs (`c.bg` → `c.accentInk`) found along the way.

- ~~**A1. Apply `ScreenHeader` + tokens to remaining screens**~~ — Dashboard, Studio, Grid, Checklist, Settings, Templates (list + detail), trip-create all done.
- ~~**A2. Studio → catalog cards**~~ — wardrobe grid now uses `CatalogCard`; category colour coding retired app-wide (Studio filters, Studio type picker, Grid slots) per the v2 "no filled colour chips" rule — physical garment colour swatches kept, category colour removed.
- ~~**A3. Dashboard rebuild**~~ — `StatTile` row, `TripCard` carousel, nudges on `accentSoft`.
- ~~**A4. Theme toggle live**~~ — Settings now has an actual `Toggle` row wired to `ThemeProvider.toggle` (which already persisted via AsyncStorage).
- ~~**A5. Retire unused styles**~~ — dead style objects removed from every file touched this pass (no `dayChip`/`indicatorDot` found — already gone).

Not done in this pass (flagged, not fixed): `templates/[id].tsx` has an unused `refreshAll` destructure, and `lookbook.tsx` has an unused `api` import — plus a few pre-existing lint warnings in untouched files (`community.tsx`, `api.ts`, `communityRepo.ts`, `firestoreRepo.ts`, `weather.ts`). None block anything; listed here so they don't get re-discovered as new.

## Phase B — New experience surfaces (the UX gaps) ✅ done 2026-07-23

- ~~**B1. Real Settings screen**~~ — profile (name/email), theme toggle, airline profiles (select/add/remove), notifications (disabled placeholder — real push is E1), Feedback (existing), Legal (Privacy/Terms rows show "coming soon" — **no real URL exists yet, still needs F2**), Sign out, Delete account.
- ~~**B2. Client-side account deletion**~~ — `wipeAllUserData(uid)` wipes wardrobe (+ Storage photos), trips (+ reflections), saved-post pointers, authored posts, authored templates, follow edges, then deletes the Firebase Auth user (with password/Google reauth handling). **Known gap:** doesn't sweep like/save/comment docs left on *other* users' content — Firestore can't cheaply query that from the client; would need a Cloud Function for full correctness.
- ~~**B3. Batch photo import**~~ — multi-select → downscale → one-tap category triage (built as large tap targets, not literal swipe gestures, for reliability). Skips cutout/palette calls during import for speed; polish happens later via the normal item editor.
- ~~**B4. Guided first-run**~~ — turned out to already exist (`SampleCapsuleCard` on the empty dashboard, wave 1) — just fixed a leftover text-contrast bug in it.
- ~~**B5. Packing-day mode**~~ — new `ProgressRing` component (added `react-native-svg` dependency), essentials reordered before the grid, weight-vs-limit and haptics already existed.
- ~~**B6. Post-trip card on Dashboard**~~ — the post-trip nudge already existed; added `computeWearInsights` (packed-vs-worn ratio per item across reflected trips) surfaced as a new "WEAR INSIGHTS" card on the Dashboard.
- ~~**B7. Repack flow**~~ — Lookbook's post-trip panel now offers "Duplicate" (new trip, same destination, grid copied minus last time's unused items) and "Save as template" (→ `users/{uid}/private_templates`, owner-only); Studio has a new "My templates" list to apply/delete them.

**Action needed from you:** `firestore.rules` gained a `private_templates` match block (B7) — deploy it with `firebase deploy --only firestore:rules` before repack-saved templates will read/write. Also added `react-native-svg` as a new native dependency (B5's progress ring) — should work in Expo Go, but if you're on a custom dev client it may need a rebuild.

## Phase C — Retire the backend
The app only still touches FastAPI/Mongo for three things. Close them, then shut it down (~2,500 lines of Python retired).

- **C1. Analytics** → Firebase Analytics SDK or a `feedback`/`events` Firestore collection. *(S)*
- **C2. Background cutout decision** — the collage canvas and clean catalog plates want cutouts, currently rembg on the backend. Options: on-device ML Kit selfie/subject segmentation, a Cloud Function (needs Blaze), or drop it and use raw photos. **Decision needed.** *(M–L depending on choice)*
- **C3. Palette extraction** → move client-side (already has a tag-based fallback) or drop. *(S)*
- **C4. Decommission** — remove Render service, archive `backend/`, delete `api.ts` axios paths. *(S)*

## Phase D — Flagship feature: collage canvas ("style it")
Depends on C2 (cutouts) for the wow factor.

- **D1. Canvas screen** — enter from an outfit card; 3 items on a board, drag/pinch/rotate (reanimated + gestures already in the grid), tap for z-order. *(L)*
- **D2. Capture + share** — `view-shot` → share sheet (Instagram). Reuses the wiring from the grid share. *(S)*

## Phase E — Monetization + notifications
- **E1. Push notifications** — `expo-notifications`, local scheduled from the existing nudge logic ("Trip in 3 days, grid incomplete"). No server. Highest retention lever. *(M)*
- **E2. RevenueCat + paywall** — required before enabling Pro safely (client can't be trusted to set `is_pro`; needs a verified purchase → Cloud Function). One good paywall screen. *(L)*
- **E3. AI auto-tagging (Pro)** — vision call at item-creation to suggest category/colors/warmth from the photo. Slots in cleanly since tags are already normalized. *(M)*

## Phase F — Quality + launch prep
- **F1. Community feed decision** — currently hidden for v1. Keep hidden until retention data, or invest in it. *(decision)*
- **F2. Hosted privacy policy + terms** — store requirement; static page. *(S)*
- **F3. CI** — GitHub Actions: `pytest` (while backend lives) + `tsc --noEmit` + `expo lint` on PR. *(S)*
- **F4. Feed query optimization** — if community ships: denormalized counters, cursor pagination (partly done in Firestore repo). *(M)*
- **F5. Usability testing** — 5 travelers, three tasks (create trip, fill grid, pack), watch silently. Drives the next cycle. *(ongoing)*

---

## Blockers / decisions you owe
1. **Blaze billing** (OR_BACR2_44 unresolved) — gates Firebase Storage and any Cloud Function (account-deletion, RevenueCat webhook, cutout). Workarounds exist (inline images, client-side delete) but Pro + cutout eventually need it.
2. **Cutout fate** (C2) — on-device vs Cloud Function vs drop. Blocks the collage canvas.
3. **Community** (F1) — ship or keep hidden.
4. ~~**accent/soft Figma alias**~~ — resolved: the design handoff's `fig-tokens.css` already has Bone `--color-accent-soft` pointing at `blue-100`, not `blue-500`. Verified in `colors.ts` (`light.accentSoft: '#CEE4DE'`, matching blue-100) — no further action needed.

## Recommended order
~~Phase A~~ (done 2026-07-23) → ~~Phase B~~ (done 2026-07-23) → **C (retire backend)** ← next → D (collage) → E (notifications + Pro) → F (launch prep). Test loop + commit after each phase.

## Effort key
XS <½ day · S ~1 day · M 2–3 days · L ~1 week
