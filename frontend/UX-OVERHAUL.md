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
