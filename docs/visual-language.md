# Triangle Duel: visual language

The definitive look for everything on screen: fighters, platforms, effects, HUD and menus. If a new element doesn't fit one of the classes below, add a class here before building it.

**The idea in one line:** every game element is a **sticker painted on a concrete wall**. It has a thick black ink line, a white outline around that, a hard black shadow, top-left lighting, and spray-paint texture.

Reference mockups are in `concept/`. That folder is local and gitignored, but it exists in this checkout.

| File | What it settles |
|---|---|
| `concept/eyes.html` | Fighter body recipe, the 14 eye styles, the 4 moods. Already ported to `src/look/`. |
| `concept/platforms-world.html` | Platform recipe (#1 Cut gem, #2 Graffiti 3D) and the white drips. Use the "Clustered" drip mode. |
| `concept/buttons.html` | Menu buttons: use #1 Sticker. Its "In context" menu panel (with drips) and phone controls are the reference for menus. |
| `concept/stages.html` | Stage **layouts** (approved) and the spawn check. Its background art is **not** approved. |
| `concept/graffiti.png` | Mood reference: purple spray wall, bold outlined shapes, drips. |

The mockups are SVG at 50–60 px per meter. All their sizes are converted to world units (meters) below, so the canvas renderer can use them at any zoom.

---

## 1. Element classes

Everything drawn falls into one of four classes. The class decides which layers it gets.

| Class | What | Ink line | White outline | Block shadow | Gradient and gloss | Texture |
|---|---|---|---|---|---|---|
| **Object** | Fighters, platforms, buttons, panels, stock icons | yes | yes | yes | yes | yes |
| **Mark** | Small effects: sparkles, impact bursts, KO stars, motion arcs, charge ring, sweat, off-screen arrows | yes | no | no | no (flat fill) | yes |
| **Paint** | Drips, splatter | no | (is white paint itself) | yes | no | yes |
| **Backdrop** | The wall and background shapes | thin or none | no | soft or none | no | yes, strongest |

**Brightness order (never break it):** fighters are the most saturated, then platforms and UI, then Marks (white and gold), then the backdrop (low contrast, desaturated). Platforms never use a player color.

---

## 2. The Object stack

Draw these layers from back to front. Fighters (`src/look/sticker.ts`) already do this, and every other Object must match.

1. **Block shadow:** the silhouette, solid ink at 75–80% opacity, offset down and right. It includes the white outline's thickness.
2. **White outline:** the silhouette stroked in `HALO`, with round joins.
3. **Body fill:** a top-lit gradient (see §4).
4. **Inner detail:** faces, bevels, facets, the 3D block.
5. **Ink line:** the silhouette stroked in `INK`, with round joins.
6. **Highlights:** a gloss streak and a sparkle (§4).
7. **Ground line** (platforms only): a bright stroke exactly on the collision top.

### Line weights (world units, so they're identical at the same zoom)

Every Object shares one ink line weight. Only the white outline and shadow differ, for a gameplay reason.

| Token | Value | Notes |
|---|---|---|
| `LINE` | 0.07 m | The ink line on every Object. The current fighter uses 7 sheet px × k ≈ 0.072 m. Match it. |
| `BAND_MOVING` | ≈ 0.025 m visible white | Fighters and anything that collides while moving. Kept thin so bodies don't look like they touch early (decision already made in `sticker.ts`). |
| `BAND_STATIC` | up to 0.1 m visible white | Platforms, UI, signs. Static, so the band can be fatter. This is the "sticker" read from the mockups. |
| `SHADOW_MOVING` | 0.04 m down and right | Fighters (current `SHADOW_OFFSET`). |
| `SHADOW_STATIC` | 0.16–0.2 m down and right | Platforms. UI uses the screen-pixel equivalent (§8). |
| `MARK_LINE` | ≥ 0.035 m (half of `LINE`) | Ink line on Marks. |

"Visible white" means how far the white outline shows past the ink line. If the white stroke is `w` wide and the ink stroke is `LINE` wide, the visible band is `(w − LINE) / 2`.

---

## 3. Color tokens

| Token | Hex | Use |
|---|---|---|
| `INK` | `#15101f` | All ink lines and shadows. Never pure black. |
| `HALO` | `#f3eefc` | White outlines, white drips, white Marks. |
| Player 1–4 | `#ff6b6b` `#4ecdc4` `#ffd93d` `#a78bfa` | Fighters only (`COLORS` in `render.ts`). |
| Platform | `#7b5cd6` violet (default), `#8a86a3` slate, `#2f9c95` deep teal, `#a1509f` plum | Never a player color. |
| `GOLD` | `#ffd23d` | KO stars, rewards, winner accents. |
| `POP` | `#ffd93d` | Focus rings, primary buttons. |
| Sweat | `#9fe3ff` | Wobble sweat drop. |
| Blush / tongue | `#ff8fb8` / `#ff7aa8` | Face details. |
| Wall | gradient `#2a2140` (top) to `#40305f` (bottom) | Default backdrop. Stages may shift the hue but keep it this dark and desaturated. |
| Drip shade | `#a99fcf` | The thin volume line on white drips. |

Derived shades are always mixes toward white or `INK`, never new hues. Write them as `mix(c, "#fff", t)` and `mix(c, INK, t)`, as in the mockups and `sticker.ts`.

---

## 4. Lighting and highlights

Light always comes from the **top left**.

- **Body gradient:** the direction runs from (0, 0) to (0.12–0.25, 1) in the shape's bounding box.
  - Stop 0: `mix(c, white, 0.32)`
  - Stop 0.45–0.55: `c`
  - Stop 1: `mix(c, INK, 0.3–0.38)`
- **Gloss streak:** a white stroke with round caps, 0.07–0.1 m thick, near the upper-left edge and pushed about 16–18% toward the shape's center. On fighters it runs along the upper-left side from 30% to 70% of that edge. On platforms it's a short horizontal dash plus a dot, just under the top bevel.
- **Sparkle:** one 4-point star near the upper-right corner. Fighters have one. Platforms have one or two, small. These are Marks (§6).
- **Ground line** (platforms): a stroke in `mix(c, white, 0.75)`, 0.12 m thick, with its top flush with the collision top. This is how players read where the floor is. Never hide it.

---

## 5. Texture

Texture is what makes this look like paint on a wall instead of vector clip art. It's the most important finish, and the one the game currently leaves out because the SVG filters were too slow.

### What the mockups do (so it can be reproduced)

1. **Paint grain** on Objects: fractal noise (base frequency 0.9 per mockup px, 3 octaves) is turned into a gray value of about 0.8–1.0 and **multiplied** over the fill, inside the shape's alpha only.
2. **Edge warp** on Objects: low-frequency noise (0.04 per px, 2 octaves) displaces the whole Object, including its ink line and white outline, by up to about 0.08 m. This gives the hand-painted wobble on edges. It applies to the whole Object, not only the fill.
3. **Wall speckle** on the backdrop, in two layers:
   - Light specks: noise frequency 0.9, alpha = 1.6·n − 0.95, at 45% opacity.
   - Dark specks: frequency 0.7, alpha = 0.95 − 1.8·n, at 55% opacity.
   - Faint brick courses: 2 px black lines at 10–14%.

### Rules that hold whatever the implementation

- Everything gets grain, including UI. Nothing on screen is perfectly clean.
- The edge warp is subtle. The ink line must still read as one confident line.
- Texture never changes color or lowers contrast enough to hurt readability, especially on the ground line and stock icons.

### Implementation options (dev's call)

| Option | Cost | Notes |
|---|---|---|
| **A. One screen-wide grain overlay**: a tiled noise texture multiplied over the whole finished frame | Very cheap | The "whole screen shares one texture" idea. Lock it to **world space** (it moves with the camera) so it reads as the wall's surface. If it's locked to the screen, objects look like they slide under a pane of glass. |
| **B. Bake grain and warp into sprites** when they're created (platforms at stage load, UI at startup, fighter bodies per shape and color) | Cheap at runtime | Fighters rotate, so baked texture rotates with them, which is fine. Faces are already baked this way (`sticker.ts` face cache). |
| **C. WebGL post pass**: grain plus screen-space displacement on the final frame | Medium; needs a WebGL layer | Updating the warp at 8–12 fps gives a deliberate "boiling line" look like hand-drawn animation. This is a style decision as much as a technical one. |

A + B together is probably the cheapest path that keeps the whole look: a world-space grain overlay, plus edge warp baked into static Objects.

---

## 6. Marks: the small effects

The mockups weren't consistent here. Sparkles had thin outlines, and motion arcs and the charge ring were plain white strokes with no ink. From now on:

- **Every Mark has an ink line of at least `MARK_LINE`**, so it belongs to the thick-border world.
- **Stroke-style Marks** (motion arcs, charge ring, speed lines) are **ink-cased lines**: an `INK` stroke underneath, about 2× the width, with the white or colored stroke on top. Never a bare white line.
- **Fill-style Marks** are flat white or gold with an ink line. No gradient, no white outline, no shadow.
- **One shape set.** Don't add new shapes ad hoc.

| Mark | Shape | Fill | Where |
|---|---|---|---|
| Sparkle | 4-point star, inner radius 0.28 × outer | `HALO` | Highlights on Objects |
| KO stars | Same 4-point star | `GOLD` | Three in an arc above a KO'd fighter |
| Impact burst | 10-point star, inner radius ≈ 0.45 × outer, slightly squashed | `HALO` | Hits, landings, the KO contact point |
| Motion arcs | 2 nested arcs, ink-cased | `HALO` | Under a hopping fighter |
| Charge ring | Ellipse at the foot, ink-cased | Fighter color | While charging |
| Wobble lines | Two "( )" arcs beside the foot, ink-cased | `HALO` | Leaning close to tipping |
| Sweat drop | Teardrop | Sweat | On the face while wobbling |
| Off-screen arrow | The ▽ itself, pointing out of frame | Fighter color | Screen edges |

**Banned:** floating confetti (little +'s, rings, zigzags, scattered triangles). It was tried in the stage art and read as clutter.

---

## 7. Paint: drips and splatter

Drips are white paint running off the **white outline**, not the body dripping. Only static Objects drip (platforms, UI panels). Fighters don't.

- **Color:** `HALO`, with a shadow at the same offset as the Object's block shadow. No ink line.
- **Where they start:** at the bottom of the white outline, joined with a smooth curve so they look like part of it.
- **Shape:** curve out of the edge, a straight stem tapering slightly to about 82% of its width, then a round bead about 1.3× the stem's half-width. A thin `#a99fcf` line runs down the right side of the stem for volume.
- **Clustered layout:** 2 clusters of about 3 drips on a 9.6 m floor, 1 cluster of about 2 on a 3 m pass-through, with clusters about 20–25% in from each end.
  - Floor drips: stems 0.1–0.18 m wide, 0.24–1.4 m long. The length is skewed short: a few long, many short.
  - Pass-through drips: about 0.4× the length and 0.6× the width.
  - About 25% of drips have a small detached droplet below the bead.
- **Splatter** (backdrop only): small dot clusters in accent colors, sparse.

---

## 8. Characters

- **Body:** the fighter's real triangle, so custom shapes get the look automatically. See `src/look/sticker.ts`.
- **Face:** centered on the incircle and scaled to 1.38 incircle radii. Every eye style uses the same build: white outline, block shadow offset (0.07, 0.08) in face units, ink line 0.1, and the same two-dot shine. Lids are always the body color. See `src/look/eyes.ts` and `concept/eyes.html`.
- **Four moods**, driven by the sim (`moodOf`):
  - **Idle** (also covers hopping, since hopping is the normal way to move)
  - **Charge**
  - **Wobble** (lean past `WOBBLE_LEAN`)
  - **KO**
- Mouths and brows aren't designed yet. When they are, they must follow the eye build: same outline and shadow scale, and reactions driven by the same four moods.

---

## 9. Platforms

**Approved styles:** Cut gem and Graffiti 3D (`concept/platforms-world.html`). Both are Objects with `BAND_STATIC` and `SHADOW_STATIC`, plus white Clustered drips.

**Hard rules:**
- Collision stays an axis-aligned box.
- The art's top edge is exactly the box top. The ground line sits on it.
- The art's sides line up with the box sides. Nothing visible sticks out past them at or above the top.
- Anything below the top is decoration and may go deeper than the box (bevels, the 3D block, drips). For solid platforms, keep the decoration shallow. Players can't tell that the box ends before the art does.
- Platform hue is never a player color.

**Cut gem**, in world units for a 1 m tall box:
- The body goes 1.32 m below the top.
- Top bevel plane: 0.26 m tall, inset 0.24 m, in `mix(c, white, 0.5)`.
- Bottom chamfer: 0.36 m, in `mix(c, INK, 0.45)`.
- Facet lines: ink, 0.05 m, at 55%.
- Gloss dash, plus 2 sparkles at the upper right.

**Graffiti 3D:**
- Face: 0.92 m tall, a vertical fade from `mix(c, white, 0.25)` to `c` to `mix(c, "#ff7aa8", 0.55)`.
- Inline: white, 0.05 m, 45% opacity, about 0.15 m inside the edge.
- 3D block underneath: a trapezoid 0.6 m deep converging toward the center (so it never passes the sides), in `mix(c, INK, 0.55)`, with a light edge line on its left slant.
- Two white diagonal "shine" ticks at the top left, sparkles at the top right.

**Pass-through platforms:** for now, the same style at 0.3 m thick, with smaller drips. How to tell pass-through from solid at a glance is still **open** (§12).

---

## 10. Backgrounds

- The default backdrop is the wall: dark purple gradient, faint brick, spray clouds in a darker tone, speckle.
- Per stage, change **only the hue and one big flat motif**: e.g. a big flat moon, concentric rings, a broken tile grid, a low sun with flat clouds, a blocky skyline.
- Motifs are flat cartoon shapes with soft or thin outlines and low contrast. They must stay quieter than any Object.
- **No** literal objects or signage (no trains, billboards, street signs), **no** readable text, **no** confetti. All of these were tried and rejected.

---

## 11. UI (menus, buttons, HUD)

UI elements are Objects too, so menus and gameplay look like one game.

**Decided: menu buttons use the "Sticker" style** (#1 in `concept/buttons.html`, which also has a menu mockup). It's a rounded slab with the fighter recipe. The sheet's other styles (Cut gem, Graffiti 3D, Pill) were considered and not chosen for menus. UI sizes are in CSS px, not meters, because UI doesn't zoom with the camera.

### Sticker button

| Part | Value |
|---|---|
| Shape | Rounded rectangle, corner radius 10 px. Standard size about 260 × 56–60 px. Secondary 180 × 50 px. Icon buttons square, 50–56 px. |
| Ink line | 3 px `INK`, round joins |
| White outline | 3 px visible (a `HALO` stroke 9 px wide behind the ink line) |
| Block shadow | The silhouette with the white outline's thickness, `INK` at 85%, offset 4 px right and 5 px down |
| Body | Gradient from (0, 0) to (0.15, 1): stop 0 `mix(c, white, 0.32)`, stop 0.5 `c`, stop 1 `mix(c, INK, 0.3)` |
| Primary color | `POP` `#ffd93d`, label in `INK` |
| Secondary color | Platform violet `#7b5cd6`, label in `HALO` with a 0.16 × font-size `INK` stroke behind it (paint-order stroke) |
| Gloss | A white 3.5 px round-cap dash at (10, 9) from the top left, length 16% of the width, then a 1.8 px dot 7 px past its end. 90% opacity. |
| Sparkle | A 4-point star, radius 5, about 13 px in from the right and 11 px down. Left off on buttons narrower than 70 px (it collides with icons) and when disabled. |
| Label | Permanent Marker, about 0.4 × button height, centered |
| Icons (◀ ▶ pause ▼) | Marks: `INK` fill on primary buttons; `HALO` fill with a 2.4 px `INK` line on secondary buttons. No glyph characters, draw the shapes. |
| Texture | Grain and slight edge warp, like every Object |

### States

| State | Change |
|---|---|
| Hover | Body color `mix(c, white, 0.1)` |
| Pressed | The button moves 4 px right and 5 px down onto its shadow, and the shadow is hidden, so it sinks into the wall. Release restores it. |
| Keyboard focus | A `POP` ring outside the white outline, with an `INK` casing outside that (a POP stroke 17 px wide over an INK stroke 23 px wide on the silhouette, behind the button). Never rely on hover color alone. |
| Disabled | Body color `mix(c, #6b6680, 0.7)`, label `mix(label, #6b6680, 0.5)`, no shadow, no sparkle |

### Panels and titles

- **Panels / cards:** a static Object.
  - Corner radius 14 px, ink line 5 px, white outline 4 px visible (16 px stroke), shadow 8 px right and 10 px down at 80%.
  - Fill: a gradient on `#3b2d63`, from `mix(c, white, 0.12)` at the top to `mix(c, INK, 0.3)` at the bottom.
  - White Clustered drips off the bottom edge (§7). **Approved as shown in the menu mockup:** 5 drips in two groups (three at about 22–30% of the width, two at about 72–76%), stems 6 px with a slightly wider round bead, lengths 22–70 px, each with the panel's shadow offset.
- **Title** (logo, winner banner): Sedgwick Ave Display, a 6 px `INK` stroke behind the fill, plus a solid `INK` copy offset 6 px right and 6 px down. Slight rotation (about −4°) is fine.
- **Touch controls** (◀ | Charge | ▶): Sticker buttons too. Charge is the primary (`POP`); the arrows are secondary. Shown in the mockup's phone frame. Not separately signed off, so treat as the default until reviewed.
- **Type:**
  - **Sedgwick Ave Display** (graffiti handstyle): big titles only, like the logo and the winner banner. Always with an ink stroke and an offset shadow.
  - **Permanent Marker**: button labels, headings, names.
  - **Rubik**: body text, numbers, settings. Anywhere readability matters.
  - All three are on Google Fonts. Self-host them for the game.
- **HUD:** stock icons are mini fighters with the full Object stack. Names use Permanent Marker with an ink stroke.

---

## 12. Don'ts (from review)

- Flat, unlit shapes. Every Object needs the gradient, gloss and sparkle, or it looks out of place next to the fighters.
- Changing only the outline or shadow and calling it a new design. Change the form.
- Literal city art, signage, or text in the world.
- Floating confetti Marks.
- Platforms in a player color, or anything brighter than the fighters.
- Bare white strokes. Lines are ink-cased.
- Body-colored drips. Drips are white and come off the white outline.

## 13. Open decisions

1. **Texture implementation** (§5): overlay, baked sprites, WebGL post, or a mix.
2. **Pass-through vs solid** at a glance (thickness alone may not be enough).
3. **Cut gem or Graffiti 3D** as the single platform style, or one per stage.
4. **Mouths and brows**, following the eye-sheet process: one feature at a time, on a single sheet.
5. **Touch controls**: Sticker buttons by default (§11), not yet reviewed on a real phone.
6. **Stage backgrounds** need their own sheet using the rules in §10.
