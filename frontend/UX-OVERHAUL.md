# UI/UX Overhaul Notes (2026-03-20)

## Goals

1. Make live share the dominant interface element.
2. Reduce operator friction for teacher workflows.
3. Keep student actions visible and fast.
4. Support both dark and light themes.
5. Improve hierarchy, spacing, and panel semantics for presentation use.

## Layout Strategy

The app now uses a **single persistent main stage** with layered controls:

- **Always visible:** stream canvas, compact status chips, floating action dock.
- **Teacher presentation aid:** a large on-stage QR card for fast student onboarding.
- **On demand layers:** slide-over panels for session setup and notes, centered modal for insights.
- **Header utility icons:** settings, notes, insights, and theme toggle.

This avoids constant sidebars and reduces the need for vertical scrolling.

## Key Design Decisions

### 1) Stream-first Visual Priority

- Main stage keeps a large viewport (`~60vh` minimum) with a clean black canvas and minimal overlay metadata.
- Session metadata appears in compact chips to avoid distracting from content.

### 2) Action Grouping by Intent

- Primary session actions are represented as icon buttons in a bottom floating dock.
- Role-based actions remain context-aware (teacher/student).
- Secondary/rare actions are moved into layered panels.
- Tooltips (`title`) carry text labels to reduce persistent visual noise.

### 3) Improved Feedback

- Status panel keeps connection and client identity in one place.
- Break timer remains globally visible.
- Errors are elevated in a dedicated alert block.

### 4) Theme System

- Added manual **dark/light toggle** in the top bar.
- Theme preference is persisted in local storage (`ui-theme`).
- **Default theme is light** when no user preference exists.
- Tailwind now uses class-based dark mode, enabling explicit user override.

### 5) Modern Surface Language

- Unified rounded card system (`rounded-2xl`) and subtle shadows.
- Better contrast for text/action color tokens in both themes.
- Consistent spacing rhythm and uppercase section labels for fast scanability.

### 6) Session Onboarding via URL + QR

- Session code can be carried in URL query (`?code=ABC123`) and is auto-prefilled on load.
- Role, name, and last session code are persisted in local storage and restored between visits.
- Teacher UI surfaces a copyable student join URL in settings.
- Main stage shows a large QR code (join URL payload) so students can scan from classroom distance.

## UX Impact Summary

- Less cognitive load: only critical controls remain on screen.
- Better focus: stream area is maximized and uninterrupted by persistent sidebars.
- Faster interaction: icon dock keeps high-frequency actions one click away.
- Progressive disclosure: deeper data appears only when requested.

## Future UX Improvements (Optional)

1. Resizable/collapsible side panels.
2. Keyboard shortcuts for teacher actions (`S` share, `Q` quiz, `B` break).
3. Mini participant timeline showing confusion/break trend over time.
4. Focus mode that auto-hides setup panel after join.

## 2026-03-20 — Visual Identity Pass (VIA + Apple-inspired)

This pass focused on **presentation quality** and a more polished institutional visual language.

### Additions

- Reworked shell into a clean light-first aesthetic with subtle sky tones inspired by VIA brand surfaces.
- Introduced softer elevation model (large-radius cards, blurred translucent layers, restrained shadows).
- Upgraded stage container and overlays to feel like a modern “control room” rather than a utility dashboard.
- Added compact right-side intelligence rail to keep key session metadata visible without cluttering the stream.
- Refined quiz, break banner, and metrics cards with improved hierarchy and readability from projected screens.
- Removed non-essential top title/description to maximize visual focus on stream content.
- Added teacher quiz controls for live moderation:
	- full-screen cover toggle,
	- global voting stop/resume,
	- show/hide quiz toggle.
- Increased quiz typography substantially in cover mode for long-distance readability.

### Why this matters

- Better first impression in demos and faculty presentations.
- Reduced visual noise while preserving all existing teacher/student workflows.
- Improved readability and spacing rhythm for both laptop and projector usage.

## 2026-03-20 - Professional Refinement Pass (Neutral + Editorial)

This pass focused on making the interface feel more premium and presentation-grade while keeping the existing information architecture and feature set intact.

### Additions

- Replaced custom inline SVG icons with `lucide-react` to standardize iconography and improve visual consistency.
- Shifted from mixed accent colors to a restrained neutral system with one blue accent for key emphasis.
- Introduced a more editorial typographic pairing:
  - UI/body: `Manrope`
  - Display headings: `Fraunces`
- Upgraded shell atmosphere with layered gradients, subtle grid texture, and soft motion (`fade-up`) for initial load polish.
- Refined stage overlays, floating action dock, and side intelligence rail with crisper spacing, cleaner contrast, and stronger visual hierarchy.
- Restyled quiz overlay, break banner, and stat cards to align with the same professional surface language.

### Why this matters

- The UI now reads as a cohesive product rather than a collection of utilities.
- Visual emphasis is clearer on projected screens: stream first, controls second, analytics third.
- Standardized icons and restrained color improve trust and reduce visual fatigue in longer sessions.

## 2026-03-20 - Typography System Pass (Scandinavian Neo-Grotesque)

This pass aligned the UI typography with a stricter institutional minimal style.

### Additions

- Removed external web-font loading and standardized to a local-first stack:
	- `Inter`, then immediate system-ui neo-grotesque fallbacks.
- Replaced serif/editorial heading treatment with neo-grotesque headings.
- Enforced heading hierarchy for `h1/h2/h3`:
	- bold/extra-bold weights,
	- tighter tracking (`-0.02em`),
	- deep charcoal heading color in light mode.
- Added baseline rhythm tokens and consistent text line-height for a stricter geometric grid feel.
- Added explicit hero/lead text style (`.hero-subtext`, `.lead`) using light weight and mid-dark gray.
- Added pastel-surface contrast guardrails (`.pastel-surface`) to force darker regular-weight body text for AA-safe readability.

### Why this matters

- Improves legibility in classroom projection contexts.
- Reduces visual inconsistency caused by mixed typography identities.
- Prevents low-contrast thin text on tinted cards/containers.
