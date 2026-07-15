# Accessibility and mobile audit

Date: 2026-07-15

## Scope

- Dashboard at 1440px desktop and 390px mobile viewport.
- Mobile layout at 200% CSS zoom.
- Keyboard path: open Watchlist, focus a symbol, select it, and verify the chart alternative remains available.
- Semantic checks for named controls, document language, and Canvas alternatives.
- Visible target-size and horizontal-overflow checks.

## Confirmed in the automated audit

- Desktop and mobile pages load without horizontal overflow.
- 200% zoom stays within the mobile reflow tolerance.
- Watchlist can be opened and switched with keyboard input.
- Canvas charts expose a live text summary.
- Interactive controls checked by the audit have accessible names.
- The audit captured desktop, mobile, and 200% screenshots under `output/playwright/`.

## Evidence limits

This is not a full WCAG conformance claim. A screen reader pass with NVDA/VoiceOver, OS-level high-contrast modes, browser text-only zoom, color-contrast measurement against the final rendered font weights, and real iOS/Android touch testing still require a human/device pass.
