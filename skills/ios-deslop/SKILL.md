---
name: ios-deslop
description: Clean up AI-generated "slop" in Swift/iOS codebases. Use when asked to deslop, clean up, refactor, or improve code quality in an iOS/Swift project. Catches comment pollution, zombie code, over-abstraction, cargo cult patterns, placeholder syndrome, verbosity, import hoarding, inconsistency, and copy-paste drift. Runs builds and tests after changes to ensure nothing breaks.
---

# iOS Deslop

Systematically clean AI-generated slop from a Swift/iOS codebase while preserving functionality.

## Workflow

### 1. Reconnaissance

Before changing anything:

1. Identify the project structure: find `.xcodeproj`/`.xcworkspace`, `Package.swift`, scheme names
2. Check for linting config: `.swiftlint.yml`, `.swift-format`
3. Read 5-10 representative files to learn the project's conventions:
   - Naming patterns
   - Architecture (MVVM, TCA, MVC, etc.)
   - State management (`@Observable` vs `ObservableObject` vs plain)
   - Concurrency style (async/await vs Combine vs GCD)
   - Testing patterns (XCTest vs Swift Testing)
4. Note the project's style as the **canonical style** — match it, don't impose your own

### 2. Identify Slop

Work through files systematically (not randomly). For each file, check for these patterns in order:

1. **Comment pollution** — delete comments that restate code; keep "why" comments
2. **Zombie code** — remove dead code, `print()` statements, unused imports, empty stubs
3. **Placeholder code** — delete or implement TODOs, remove sample data from production paths
4. **Verbosity** — collapse verbose patterns into idiomatic Swift
5. **Import hoarding** — remove unused imports
6. **Safety theater** — remove unnecessary guards/optionals on non-optional values
7. **Over-abstraction** — collapse single-conformer protocols, thin wrappers, unnecessary layers
8. **Cargo cult patterns** — remove patterns that don't match the project's paradigm
9. **Inconsistency** — align with the canonical style found in recon
10. **Copy-paste drift** — extract shared logic from near-duplicate code

For detailed examples of each pattern, read `references/ai-slop-patterns.md`.

### 3. Apply Fixes

- Work **one file at a time** — complete all fixes in a file before moving to the next
- Make **minimal, focused changes** — don't refactor what doesn't need refactoring
- Preserve existing behavior exactly — this is cleanup, not feature work
- When in doubt, leave it alone
- Follow Swift guidelines in `references/swift-guidelines.md` for proper patterns

### 4. Verify After Every Batch of Changes

After completing each logical batch of changes (e.g., finishing a group of related files):

```bash
# Build the project — MUST pass
xcodebuild -scheme <SchemeName> -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -20

# Run tests — MUST pass
xcodebuild -scheme <SchemeName> -destination 'platform=iOS Simulator,name=iPhone 16' test 2>&1 | tail -40

# If the project uses SPM:
swift build
swift test

# If SwiftLint is configured:
swiftlint lint --strict 2>&1 | head -30
```

**If builds or tests fail after your changes, fix them immediately before proceeding.**

Find the correct scheme name:
```bash
xcodebuild -list 2>&1 | head -20
```

Find available simulators:
```bash
xcrun simctl list devices available | grep iPhone | head -5
```

### 5. Report

After completing the deslop pass, provide a summary:
- Files modified (count)
- Categories of slop found (with counts)
- Any files skipped and why
- Build/test status
- Suggestions for further improvement (if any)

## Rules

- **Never change public API signatures** unless explicitly asked
- **Never change behavior** — output, side effects, and error handling must remain identical
- **Preserve git blame** — make minimal line changes, don't reformat entire files gratuitously
- **One concern per commit** — if making git commits, group by slop category
- **Ask before removing** anything that looks intentional but suspicious
- **Test-driven confidence** — if you can't verify a change with build/test, don't make it

## Priority Order

If the codebase is large, prioritize:
1. Files with the most slop (usually AI-generated files are obvious)
2. Core models and business logic
3. View models / state management
4. Views and UI code
5. Extensions and utilities
6. Tests (yes, test code gets sloppy too)
