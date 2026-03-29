# Project: iOS Fence (Premium, Local-First)

## Identity
- **Name:** TBD (Internal: "Project Vault")
- **Target Audience:** India-first, premium segment (willing to pay ₹100/mo).
- **Core Value:** "Apple-native" feel, local-first privacy, automation via Shortcuts.
- **Current State:** Functional transaction list (Swift/Shortcuts automation enabled), but needs UX overhaul.

## Design Philosophy
- **Vibe:** "Pilot's HUD" (Control) + "Social Feed" (Narrative).
- **Aesthetic:** Deep blacks (OLED), glassmorphism, SF Pro Rounded typography.
- **Interaction:** Heavy haptics, squish animations, "odometer" number rolling.
- **Hero Metric:** "Safe to Spend" (Balance minus upcoming bills) > generic "Total Balance".

## Selected Dashboard Concept: "Card + Feed"
**Layout Structure:**
1.  **Hero (Top 35%):**
    *   Dynamic Status Card (Swipeable or Context-Aware).
    *   Primary Data: "Safe to Spend" amount.
    *   Visual: Deep Indigo/Purple gradient card with progress bar/burn rate.
2.  **Feed (Bottom 65%):**
    *   Scrollable transaction list grouped by date (Today, Yesterday).
    *   Rich merchant logos/emojis (no boring text lists).
    *   Glassmorphic row styles.

## Features
- **Automation:** Shortcuts-based transaction logging (already built).
- **Privacy:** 100% Local (no server sync).
- **Input:** Gesture-based manual entry (drag to add) + Automation.

## Next Steps
- Refactor existing List view into "Feed" view.
- Build the "Safe to Spend" Hero component.
- Polish interactions (haptics, animations).

## Sprint Status Update (2026-02-13)

A full stacked implementation pass was completed in local branches (PR-1 → PR-8), including:
- parser/source integrity fixes,
- first-run onboarding flow,
- premium dashboard hero enhancements,
- analytics + charts,
- ML-ready inference scaffold,
- CSV/PDF export,
- iCloud sync bootstrap with local fallback,
- widget quick-entry + deep-link flow.

Branch chain and commits:
1) `fix/pr1-parser-source-integrity` (`3376144`)
2) `feature/onboarding-dummy-flow` (`61e757f`)
3) `feature/dashboard-hero-enhancement` (`dde3363`)
4) `feature/spending-analytics-charts` (`a47f038`)
5) `feature/ml-category-inference` (`81882fe`)
6) `feature/export-csv-pdf` (`7aecaec`)
7) `feature/icloud-sync` (`f447433`)
8) `feature/widgets-quick-entry` (`4e89ded`)

Update (2026-02-18): Nisch confirmed the PR stack was validated on Mac (xcodebuild/tests) and merged.
