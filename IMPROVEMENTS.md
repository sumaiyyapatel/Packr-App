# Packr — Improvement Audit
*Generated 2026-07-19 from a full review of `backend/server.py` (2,590 lines), the Expo frontend, `render.yaml`, and dependency manifests.*

Priorities: **P0** = fix before/at launch, **P1** = next milestone, **P2** = later.

---

## 1. Security

### P0 — Firebase token expiry breaks sessions after ~1 hour
`src/lib/api.ts:39` reads a static token from AsyncStorage on every request, but Firebase ID tokens expire after ~60 minutes. The token is only refreshed in `hydrate()` (app cold start), so any session longer than an hour starts returning 401s until restart.
**Fix:** in the request interceptor, call `auth.currentUser?.getIdToken()` (the SDK auto-refreshes and caches). Add a response interceptor: on 401, force-refresh (`getIdToken(true)`) and retry once before logging out.

### P0 — `/me/pro` grants Pro for free
`server.py:2359` — any authenticated user can `POST /api/me/pro` and set `is_pro: true`. It's currently masked because `FEATURE_PRO_ENABLED` defaults off, but the moment you enable Pro this is an open door.
**Fix:** integrate RevenueCat (or Play Billing server verification). The endpoint should verify a purchase token server-side before flipping `is_pro`. Never trust a bare client call for entitlements.

### P0 — No rate limiting anywhere
Registration, login, image uploads (`/uploads/*`, `/cutout` runs rembg — CPU heavy), `/analytics/events`, and `/feedback` are all unlimited. One hostile client can fill your DB or peg the CPU.
**Fix:** add `slowapi` (or a middleware) — e.g. 5/min on auth, 20/min on uploads, 60/min default. Also note `/weather` and `/geocode` require no auth at all; add `get_current_user` or at least IP throttling so you're not an open proxy to Open-Meteo.

### P1 — Token stored in plaintext AsyncStorage
`packr.token` lives in AsyncStorage, readable on rooted devices/backups.
**Fix:** `expo-secure-store` (not currently in package.json) for the token; keep non-sensitive caches in AsyncStorage.

### P1 — Mongo field-path injection via user-supplied keys
`server.py:1292` — `{'$set': {f'checklist_state.{payload.item_key}': ...}}` and `server.py:1155` (`occasion_tags.{key}`) interpolate client strings into update paths. A key containing `.` or `$` creates nested/garbage fields or throws server errors.
**Fix:** validate `item_key` against a strict pattern (e.g. `^(grid|ess|ext):[A-Za-z0-9-]+$`) before using it in a path.

### P1 — No account deletion endpoint
Google Play (and App Store) require in-app account deletion for apps with account creation. There is none — and no data-deletion path for wardrobe/trips/posts/uploads.
**Fix:** `DELETE /api/me` that removes user doc, wardrobe, trips, reflections, posts, likes/saves/follows, comments, uploaded files, and the Firebase user (`firebase_auth.delete_user`). Add a settings screen entry plus a hosted privacy policy URL (also a store requirement).

### P1 — Analytics/feedback are unbounded write endpoints
`AnalyticsEventCreate.properties` is an arbitrary `Dict[str, Any]` with no size cap, and events accumulate forever.
**Fix:** cap serialized property size (~2 KB), whitelist event names, and add a TTL index on `analytics_events.created_at` (e.g. 90 days).

### P2 — Smaller items
- `verify_id_token` doesn't use `check_revoked`; consider it for logout-everywhere.
- Unbounded in-memory `HTTP_JSON_CACHE` (`server.py:1399`) — add max size/LRU eviction.
- `CORS_ORIGINS` in `render.yaml` points at the backend's own domain — useless. Set it to your actual web origin(s); native apps don't send Origin so this only matters for Expo web.
- Invite codes (`server.py:1277`) are short, destination-derived, non-expiring — and there is **no accept/redeem endpoint at all** (only list + create). Either finish the flow with long random codes + expiry, or cut the feature (see §5).
- Add security headers middleware (HSTS, X-Content-Type-Options) for the web export.

---

## 2. Architecture & code health

### P0 — Uploads die on every Render deploy
Images are written to local disk (`UPLOAD_DIR`, mounted at `/uploads`). Render's filesystem is **ephemeral**: every deploy/restart wipes all wardrobe and community images. This is the biggest production-correctness bug in the app.
**Fix:** move to object storage — Cloudflare R2 (free egress) or Firebase Storage (you already have the Firebase project). Store full URLs; keep `PUBLIC_UPLOAD_BASE_URL` pattern. Migrate `resolve_local_upload_path` logic accordingly.

### P1 — Split the 2,590-line `server.py`
One file holds models, auth, image rendering, 60+ routes, and seed data. Suggested layout:

```
backend/
  app/
    main.py            # app factory, middleware, lifespan
    config.py          # env parsing (already well-factored, just move it)
    models/            # pydantic schemas
    routers/           # auth, wardrobe, trips, community, templates, uploads, misc
    services/          # outfit scoring, stats, image rendering, storage
    db.py              # client + index creation
```
Also migrate deprecated `@app.on_event` (`server.py:2494, 2588`) to the lifespan handler — FastAPI has deprecated it.

### P1 — N+1 query storm on the community feed
`enrich_post` (`server.py:892`) runs ~6 queries per post, and `sync_post_counts` adds 3 `count_documents` per post *per view*. A 30-post feed = 100+ Mongo round-trips; `list_trending_posts` loads 200 posts then sorts in Python.
**Fix:** keep denormalized counters updated with `$inc` at like/save/comment time (you already do this for template likes), batch the viewer's likes/saves/follows with three `$in` queries per page, and use an aggregation pipeline for trending. Add cursor pagination (`created_at < cursor`) instead of `limit`-only.

### P1 — Close the data loop you already collect
Trip reflections (worn/unused items) are stored but never used. `destination_context_tags` (`server.py:589`) guesses climate from hardcoded city names ("bali", "miami"...) even though trips have lat/lon and you already call Open-Meteo.
**Fix:** feed real forecast data into `score_outfit`, and penalize items the user marked "unused" on past trips. This turns two existing features into a genuinely smart suggester — no new APIs needed.

### P2 — Other
- `rembg` on a small Render instance will OOM or cold-start slowly (~170 MB model). Make it opt-in via env, or move cutout to on-device/queue. The Pillow fallback you wrote is decent.
- Update deps: FastAPI 0.110 / uvicorn 0.25 are ~2 years old; axios `import { create }` relies on CJS interop — use `axios.create`.
- Tests exist (7 backend test files — good). Add GitHub Actions CI: `pytest` + `tsc --noEmit` + `expo lint` on PR.
- Silent failure: `toggleChecklistOptimistic` (`store.ts:299`) swallows errors — the checkbox lies if the request fails. Roll back state and toast on failure; consider a small offline mutation queue given the travel (offline!) context.

---

## 3. Design & UX

### P1 — Design tokens are too thin
`colors.ts` is clean but there's no spacing/typography/radius scale, so every screen re-declares `kicker`/`title`/`iconBtn` styles (compare `settings.tsx` vs the tab screens). Screens are huge (`community.tsx` is 1,186 lines).
**Fix:** add `theme/tokens.ts` (spacing 4/8/12/16/24/32, radii, type scale) and extract shared components (`ScreenHeader`, `Card`, `EmptyState`, `SectionTitle`). This alone will make the app feel consistent.

### P1 — Contrast failures in dark mode
`textTertiary #555555` on `#000000` is ~2.9:1 and `textSecondary #8B8B8B` is borderline — below WCAG AA (4.5:1) for the small text you use them on. Light mode `#AAAAAA` on white fails too.
**Fix:** bump tertiary to ~#7A7A7A (dark) / #8A8A8A (light); verify with a contrast checker.

### P1 — Zero accessibility props
No `accessibilityLabel`/`accessibilityRole` anywhere in `app/` or `src/`. Icon-only buttons (back chevrons, grid slots, like buttons) are invisible to screen readers.
**Fix:** add roles/labels to all `Pressable`s; minimum 44pt touch targets (the 36px icon buttons are slightly under).

### P1 — Settings screen is only a feedback form
No profile editing, no theme toggle surfaced there, no logout, no delete-account, no privacy/terms links. Stores will reject without the last two.

### P2 — Polish opportunities
- Load a brand font (`expo-font` is installed; Inter or a grotesk for the "PACKR" kickers) — system fonts undersell the strong editorial look you're going for.
- Use `expo-haptics` (installed, appears unused) on grid slot placement, checklist ticks, and packing-score milestones.
- Skeleton loaders for dashboard stats/weather instead of blank → pop-in.
- Dashboard fires weather requests sequentially per trip (`index.tsx:69`) — `Promise.all` them.
- Animate the packing score (reanimated is available via Expo) — it's your hero metric.

---

## 4. APIs & new capabilities

| Idea | Effort | Notes |
|---|---|---|
| **Push notifications** (`expo-notifications`, not installed) | M | Your `retention/nudges` endpoint already computes pre-trip/post-trip nudges — they're only visible in-app. Delivering "Trip in 3 days, grid incomplete" as a push is the single highest-leverage retention change. |
| **Real weather → suggestions** | S | Already have Open-Meteo + lat/lon; wire into `score_outfit` (see §2). |
| **AI packing assistant** (Claude/OpenAI API) | M | Auto-tag wardrobe photos (category/color/warmth from image), natural-language trip advice ("swap a layer, Lisbon is 31°C"), smarter outfit reasons. One vision call at item-creation time is cheap. |
| **Airline baggage dataset** | S | Replace the 2 hardcoded profiles with a static JSON of ~50 airlines' carry-on limits (updateable server-side). Pro: custom profiles. |
| **Share/export** | S | Export checklist as PDF & grid image via native share sheet — you already render post images server-side; reuse for sharing outside the app (organic growth). |
| **Destination extras** | S | REST Countries / travel-advisory APIs: plug type, currency, visa hint on the trip card. |
| **RevenueCat** | M | Required to launch Pro safely (see §1). |

---

## 5. Product decisions to make

1. **Trip invites are half-built** — create + list exist, but there is no accept/redeem endpoint and no companion experience. Ship it (shared checklist for couples/families packing together is a real differentiator) or cut it before launch; dead UI erodes trust.
2. **Templates clone items into the wardrobe** (`apply_template`) with cleanup heuristics. Consider making template items a separate "borrowed" layer instead of polluting the user's wardrobe — the `from-template` tag cleanup logic is fragile.
3. **Community moderation**: you collect reports (`community_reports`) but have no admin surface. Before public launch you need at minimum a hide-post flag an admin can set, and a blocked-users list per user (store policy for UGC apps: block + report are both required).
4. **Pro pricing surface**: `pro.tsx` is 43 lines — a placeholder. Decide the paywall moment (likely: 3rd trip creation, custom airline add, template publish) and build one good paywall screen.
5. **Post-trip reflection → wardrobe insights** is your moat. "You've packed this jacket on 4 trips and never worn it" is the feature screenshot-worthy enough to market on.

---

## Suggested order of attack

1. Object storage for uploads (data loss bug) — §2
2. Token refresh interceptor + secure storage — §1
3. Rate limiting + checklist key validation — §1
4. Account deletion + privacy policy + block/moderation basics — §1/§5
5. Push notifications for existing nudges — §4
6. Feed query optimization + pagination — §2
7. Design tokens + shared components + contrast/a11y pass — §3
8. Weather-driven suggestions + reflections loop — §2/§4
9. RevenueCat + paywall, then enable `FEATURE_PRO_ENABLED` — §1/§5
