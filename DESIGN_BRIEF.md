# Packr v1 — Design & UX Brief
*Agreed 2026-07-22. Working doc for the design pass: discuss → Figma → implement.*

## Direction
Minimal, neutral, image-first — the UI is a gallery wall; clothes are the content.

- Two themes: **warm charcoal** (~#161412, not pure black) and **warm ivory** (~#FAF8F4), user-switchable.
- Exactly one accent (current sage family). No filled color chips; category becomes small monochrome labels. Hairline borders, generous whitespace.
- One quiet grotesk for UI + letter-spaced kickers as brand voice. Strict type scale, defined in tokens.
- Minimal via discipline, not feature removal.
- Awaiting: user's reference images → token spec finalized against them.

## Product decisions (locked)
- Grid stays **clothes-only** (top/bottom/layer 3×3). No shoes/accessory categories. Possible later: optional "finishing touches" note per outfit.
- **Community tab hidden for v1** (code stays). Share-out to Instagram is the social feature.
- AI auto-tagging from photos = **Pro feature, later**.
- Challenge votes = post likes (already implemented).

## v1 experience spine
guided start → batch add → grid → calendar plan → packing-day mode → Instagram share → post-trip review → repack next time

## Build list (design in Figma first for ★ items)
1. ★ **Design tokens + shared components** — palettes, type scale, spacing (4/8/12/16/24/32), radii; ScreenHeader, Card, EmptyState, SectionTitle. Theme toggle in Settings.
2. ★ **Calendar planner** (replaces date-pill row in Lookbook) — month grid, trip span highlighted, dimmed non-trip days, outfit thumbnail in planned cells, weather glyph per day (data already fetched), tap → bottom sheet with 27 outfits ranked by suggestion score. Hand-rolled grid, no library.
3. ★ **Collage canvas ("style it")** — entered from an outfit card, NOT replacing lookbook browsing. v1: one outfit's 3 items, drag/pinch/rotate, tap for z-order, capture → share sheet. No saved layouts. Depends on cutouts for wow (backend rembg for now; ML Kit / Cloud Function later).
4. **Guided first-run** — offer "start from a capsule" (template apply) at the empty-dashboard moment.
5. **Batch photo import** in Studio — multi-select → downscale → swipe category assign. Kills the 9-item cold-start problem. Highest-impact UX change.
6. **Repack flow** — duplicate trip / save grid as private template; surface "unused last time" from reflections.
7. **Packing-day mode** — focused checklist: progress ring, weight vs airline limit, essentials first, haptic ticks. + pre-trip local notification (expo-notifications, no server).
8. **Post-trip card on dashboard** — "Back from X? 30-second review" → feeds wear-count insights ("this jacket: 4 trips, worn once").
9. **Real settings screen** — profile, theme switch, logout, **delete account** (client-side Firestore wipe + Firebase user delete — store-review blocker), privacy policy link.

## Explicitly not doing
Wardrobe search/folders, social beyond share-out, multi-bag packing, calendar sync, shoes/jewelry categories.

## Known bugs fixed this round
- Day planner off-by-one (IST timezone / toISOString) — fixed.
- Template publish over 1 MB doc limit (inline photos) — fixed, photos stripped on publish.

## Process
1. User shares minimal-UI reference images.
2. Token spec doc finalized.
3. Figma: component sheet + 3 marquee screens (Dashboard, Calendar planner, Collage canvas). Figma connector must be authorized in Claude connector settings for me to build it directly.
4. Implement wave 1 (tokens/components/calendar), then wave 2 (canvas), then items 4–9.
