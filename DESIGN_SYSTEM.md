# Packr Design System — v1
*Accent locked to **#E97121**. Built in Figma: file `47g1H7NK5Vjif6BoIyM2vT` — pages: Foundations · Components · v2 Screens · User Flow. (Original dark/green screens remain on "App Screens" as the v1 archive.)*

## Personality
Receipt/catalog editorial. Sharp, quiet, image-first. Structure from hairlines and whitespace, never boxes and fills. One accent, used surgically. The clothes are the only colourful thing on screen.

---

## 1. Color

### Bone (light)
| Token | Hex | Use |
|---|---|---|
| `color/bg` | `#FAF8F4` | screen canvas |
| `color/surface` | `#F3F0EA` | grouped sections, sheets |
| `color/elevated` | `#FFFFFF` | cards that must lift, inputs |
| `color/plate` | `#EFECE5` | catalog image plates |
| `color/text/primary` | `#1A1713` | |
| `color/text/secondary` | `#5C564E` | |
| `color/text/tertiary` | `#767066` | 4.6:1 — smallest text allowed |
| `color/border/hairline` | `#E5E0D6` | default 1px |
| `color/border/active` | `#C9C2B4` | selected / hover outlines |
| `color/accent` | `#E97121` | |
| `color/accent/ink` | `#1A1713` | text & icons ON accent fills |
| `color/accent/soft` | `#F9E5D3` | nudges, progress tracks |
| `color/danger` | `#C4432B` | destructive only |

### Charcoal (dark)
| Token | Hex |
|---|---|
| `color/bg` | `#161412` (warm near-black, never `#000`) |
| `color/surface` | `#1E1B18` |
| `color/elevated` / `plate` | `#26221E` |
| `color/text/primary` | `#F5F1EA` |
| `color/text/secondary` | `#B5AC9F` |
| `color/text/tertiary` | `#857D71` (4.5:1) |
| `color/border/hairline` | `#2E2924` |
| `color/border/active` | `#453E36` |
| `color/accent` | `#E97121` (5.9:1 — text-safe here) |
| `color/accent/ink` | `#161412` |
| `color/accent/soft` | `#3A2818` |
| `color/danger` | `#E06A50` |

### Accent rules
1. Max ~2 accent moments per screen: one selected state + one action. Never decorative.
2. On **Bone**, accent is fills-only (2.9:1 fails as small text). Text on accent fills is always `accent/ink`, never white.
3. On **Charcoal**, accent may colour text and icons.
4. Success reuses accent — there is no green. Danger is the only other hue.

---

## 2. Typography
**Space Grotesk** (display, numerals, kickers) + **Inter** (body, UI). Figma styles are namespaced `Packr/*`.

| Style | Font | Size/line | Use |
|---|---|---|---|
| `display-xl` | Space Grotesk Light | 64/68 | calendar numerals, packing score |
| `display` | Space Grotesk Medium | 40/44 | screen heroes, stat values |
| `h1` | Space Grotesk Bold | 26/32 | screen titles |
| `h2` | Inter Semi Bold | 18/24 | card titles, day numbers |
| `body` | Inter Regular | 15/22 | default |
| `label` | Inter Medium | 13/18 | buttons, list items |
| `kicker` | Space Grotesk Medium | 11/14, +2 tracking, UPPER | section markers |
| `micro` | Inter Regular | 11/14 | metadata, weights |

---

## 3. Space, shape, line
- Spacing: `4 / 8 / 12 / 16 / 24 / 32 / 48` (`spacing/xs…3xl`). Screen gutter 24.
- Radii: `radius/sharp` **2** (plates, cards, buttons), `radius/sheet` **4** (modals), `radius/pill` **999** (chips only). Nothing else.
- Borders: 1px hairline everywhere; `border/active` for selection. No shadows on Bone.
- Touch targets ≥ 44px even when the visual is smaller.

---

## 4. Components

| Component | Variants / props | Notes |
|---|---|---|
| **Chip** | `State = Default \| Selected` | Pill, hairline outline; selected = accent fill + accent/ink text. Category colours are retired. |
| **CatalogCard** | — | Square `plate` + name (`label`) + meta (`micro`). Category shown as monochrome kicker, never a colour. |
| **GridSlot** | `State = Empty \| Filled` | Empty = dashed hairline + `+`; Filled = plate + item name. 3×3 grid unit. |
| **DayCell** | `State = Outside \| InTrip \| Planned` | Outside = 35% opacity, non-interactive; InTrip shows weather micro; Planned shows accent bar. |
| **OutfitCard** | — | Three plates side by side + name + occasion/weight kicker. |
| **TripCard** | — | Dates kicker, days-left in accent, destination in `display`, meta line, progress bar. |
| **StatTile** | — | `display` value + kicker label on `surface`. Used in threes. |
| **ActionBar** | solid \| outlined | Primary = accent fill; outlined = hairline + accent arrow block (the reference "Confirm" pattern). **One per screen.** |
| **ReceiptRow** | — | Label left, value right, bottom hairline only. Checklist + settings rows. |
| **TextField** | — | Kicker label + 48px `elevated` box with `border/active`. |
| **Toggle** | — | 44×26 pill track; on = accent, knob `elevated`. |
| **EmptyState** | — | Dashed hairline container, `accent/soft` icon block, headline + one line. |
| **ScreenHeader** | — | Kicker (accent) + title + optional sub. Top of every screen. |
| **NavBar** | 5 tabs | Trips · Studio · Grid · Plan · Pack. Active tab = accent square + primary label. |
| **IconButton / Badge** | — | 44×44 hairline square; Badge = accent fill + kicker. |

### States (apply system-wide)
| State | Treatment |
|---|---|
| Default | hairline border, no fill |
| Selected / active | accent fill (chips, tabs) or `border/active` |
| Disabled | 35% opacity, no interaction (see DayCell Outside) |
| Loading | replace label with spinner, keep bar dimensions |
| Error | `danger` border + `danger` micro message below |

### Accessibility
- All icon-only controls need `accessibilityLabel`; every `Pressable` needs a role.
- Minimum text size 11px, and only `text/tertiary` or lighter contrast pairs listed above.
- Accent never carries meaning alone — always paired with text or position.
- Targets ≥44px; grid slots and day cells already exceed this.

---

## 5. Screens (16 designed)
`01 Welcome` · `02 Sign in` · `03 First run capsule` · `04 Dashboard` · `05 New trip` · `06 Studio` · `07 Add items (batch)` · `08 Grid builder` · `09 Lookbook` · `Calendar planner` · `10 Style it (canvas)` · `11 Packing day` · `12 Settings` · `13 Templates` · `14 Template detail` · `15 Post-trip` · `16 Empty state`

## 6. User flow
1. **Arrive** — Welcome → Sign in → First-run capsule offer *(skips the 9-item cold start)*
2. **Set up** — Empty state → New trip → Add items (batch import)
3. **Build** — Studio → Grid builder ← Templates → Template detail
4. **Plan** — Lookbook → Calendar planner → Style it (canvas) → share
5. **Travel** — Packing day → Post-trip reflection → Settings

**Loops:** reflection feeds outfit suggestions and the "repack from last trip" shortcut, returning users to stage 2 with a head start. Bottom nav allows jumping between stages 2–5 at any time.

---

## 7. Implementation notes (React Native)
- `theme/colors.ts` → the two palettes above; add `plate`, `accentInk`, `accentSoft`.
- New `theme/tokens.ts` → spacing, radii, and the 8 type styles as named exports. Screens stop declaring local kicker/title styles.
- Fonts: `@expo-google-fonts/space-grotesk` + `@expo-google-fonts/inter` via `expo-font` (JS-only, no dev-client rebuild).
- Extract in this order: `ScreenHeader`, `CatalogCard`, `Chip`, `ActionBar`, `ReceiptRow`, `EmptyState`, `StatTile`, `DayCell`.
- Every Figma variable carries `var(--token-name)` code syntax — Dev Mode will hand you the matching name.

## 8. Deliberately excluded
Wardrobe search/folders, shoes & accessory categories, social feed (community tab hidden for v1 — share-out to Instagram instead), multi-bag packing, calendar sync.
