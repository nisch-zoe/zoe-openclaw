# Common AI Code Slop Patterns

## Table of Contents
1. [Comment Pollution](#comment-pollution)
2. [Zombie Code](#zombie-code)
3. [Over-Abstraction](#over-abstraction)
4. [Cargo Cult Patterns](#cargo-cult-patterns)
5. [Placeholder Syndrome](#placeholder-syndrome)
6. [Verbosity Disease](#verbosity-disease)
7. [Import Hoarding](#import-hoarding)
8. [Inconsistency](#inconsistency)
9. [Safety Theater](#safety-theater)
10. [Copy-Paste Drift](#copy-paste-drift)

---

## Comment Pollution

AI loves generating comments that restate the code. These add noise and rot as code changes.

### What to Look For
```swift
// ❌ Restating the obvious
// Initialize the array
var items: [Item] = []

// Set the title
title = "Settings"

// Check if the array is empty
if items.isEmpty {
    // Show empty state
    showEmptyState()
}

// Function to calculate total
func calculateTotal() -> Double { ... }
```

### Fix
- Delete comments that restate what the code does
- Keep comments that explain **why** (business logic, edge cases, workarounds)
- Keep `// MARK:` section headers
- Keep `///` doc comments on public API

```swift
// ✅ Comments that add value
/// Price includes tax for EU customers per GDPR billing requirements
func calculateTotal(includeVAT: Bool) -> Double { ... }

// MARK: - Persistence
// Workaround: CoreData context must be saved on main thread (FB12345678)
```

---

## Zombie Code

Dead code that AI generates "just in case" or leaves behind after refactoring.

### What to Look For
- Commented-out code blocks
- Functions/properties never called from anywhere
- `print()` / `debugPrint()` statements left in production code
- Unused `import` statements
- Empty method bodies that were "going to be implemented"
- `TODO` comments with no tracking

### Fix
- Delete commented-out code (that's what git is for)
- Remove all `print()` statements — use `os.Logger` or `Logger` if logging is needed
- Remove unused imports
- Either implement empty methods or delete them
- Convert actionable TODOs to tracked issues, delete the rest

---

## Over-Abstraction

AI creates abstraction layers for things that don't need them.

### What to Look For
```swift
// ❌ Protocol with single conformer
protocol DataRepositoryProtocol {
    func fetchItems() async throws -> [Item]
}
class DataRepository: DataRepositoryProtocol {
    func fetchItems() async throws -> [Item] { ... }
}

// ❌ Manager/Helper/Utility classes that just wrap one thing
class DateFormatterHelper {
    static func formatDate(_ date: Date) -> String {
        // just wraps DateFormatter
    }
}

// ❌ Generic base classes with one subclass
class BaseViewModel<T> { ... }
class ItemViewModel: BaseViewModel<Item> { ... }
```

### Fix
- Single-conformer protocols → use the concrete type; extract protocol later when you need it
- Thin wrappers → use the underlying API directly or make it an extension
- Base class with one child → collapse into the child
- **Rule of three**: abstract when you have three concrete cases, not before

---

## Cargo Cult Patterns

AI copies patterns it's seen without understanding the context.

### What to Look For
```swift
// ❌ Combine usage in a SwiftUI + async/await project
class ViewModel: ObservableObject {
    @Published var items: [Item] = []
    private var cancellables = Set<AnyCancellable>()
    // ... when the rest of the app uses @Observable + async/await
}

// ❌ Coordinator pattern in a simple app
class AppCoordinator { ... }
class HomeCoordinator { ... }
class SettingsCoordinator { ... }
// ... for a 5-screen app

// ❌ Repository + UseCase + DataSource layers for a simple API call
```

### Fix
- Match the existing project patterns — don't introduce new paradigms
- Simpler is better until complexity demands otherwise
- If the project uses `@Observable`, don't add `ObservableObject`
- If the project uses structured concurrency, don't add Combine

---

## Placeholder Syndrome

AI leaves behind placeholder or template code that doesn't do anything real.

### What to Look For
```swift
// ❌ Generic placeholder implementations
func handleError(_ error: Error) {
    // Handle error appropriately
    print("Error: \(error)")
}

// ❌ Stub implementations
func saveToDatabase() {
    // TODO: Implement database saving
}

// ❌ Fake data mixed in with real code
let sampleItems = [
    Item(name: "Sample Item 1"),
    Item(name: "Sample Item 2"),
]
```

### Fix
- Implement real error handling or propagate the error
- Delete stubs — they create false confidence
- Move sample/preview data to `#Preview` blocks or test targets
- Search for "TODO", "FIXME", "HACK", "sample", "example", "placeholder"

---

## Verbosity Disease

AI writes 10 lines where 3 would do.

### What to Look For
```swift
// ❌ Unnecessarily verbose
func isItemValid(_ item: Item) -> Bool {
    if item.name.isEmpty == false {
        if item.price > 0 {
            return true
        } else {
            return false
        }
    } else {
        return false
    }
}

// ✅ Concise
func isItemValid(_ item: Item) -> Bool {
    !item.name.isEmpty && item.price > 0
}
```

```swift
// ❌ Over-explicit type annotations
let items: [Item] = [Item]()
let formatter: DateFormatter = DateFormatter()
let isValid: Bool = true

// ✅ Type inference
var items: [Item] = []
let formatter = DateFormatter()
let isValid = true
```

### Fix
- Collapse nested `if/else` into guard clauses or boolean expressions
- Remove redundant type annotations (keep them when they aid readability)
- Use Swift's syntactic sugar: trailing closures, implicit returns, shorthand argument names
- Prefer `guard` for early exits over nested `if let`

---

## Import Hoarding

AI imports frameworks it doesn't use or imports `UIKit` when only `SwiftUI` is needed.

### What to Look For
```swift
// ❌ Unnecessary imports
import UIKit        // in a SwiftUI-only file
import Foundation   // already imported by SwiftUI/UIKit
import Combine      // not using any Combine types
import os           // no logging in this file
```

### Fix
- Remove unused imports
- `SwiftUI` implicitly imports `Foundation` — no need for both
- `UIKit` implicitly imports `Foundation`
- Only import what you directly use

---

## Inconsistency

AI generates code that doesn't match the existing codebase style.

### What to Look For
- Mixed indentation (tabs vs spaces, 2 vs 4 spaces)
- Inconsistent brace style
- Some files use `@Observable`, others `ObservableObject`
- Mix of `async/await` and completion handlers for similar operations
- Inconsistent error handling strategies (some throw, some return optionals)
- Inconsistent naming patterns across similar types

### Fix
- Match the existing project's conventions
- If the project uses SwiftLint, check `.swiftlint.yml` for rules
- When upgrading patterns (e.g., Combine → async/await), do it consistently across related files
- One pattern per concern across the codebase

---

## Safety Theater

AI adds excessive guards, force-unwrap avoidance, or nil-checks that aren't needed.

### What to Look For
```swift
// ❌ Unnecessary optional binding
guard let self = self else { return } // in a struct method
guard let items = self.items else { return } // items isn't optional

// ❌ Double-checking non-optional values
if let value = nonOptionalValue {
    use(value)
}

// ❌ Overly defensive collection access
if array.count > 0 {
    if let first = array.first {
        // ...
    }
}
```

### Fix
- Only guard against actual optionals
- Trust the type system — if it's non-optional, use it directly
- Use `array.first` or safe subscript only when the collection might genuinely be empty
- Remove redundant `self` captures in value types

---

## Copy-Paste Drift

AI duplicates code blocks with minor variations instead of extracting shared logic.

### What to Look For
- Multiple views with near-identical layout code
- Repeated API call patterns that differ only in URL/parameters
- Similar model transformations across files
- Duplicated validation logic

### Fix
- Extract shared view components
- Create generic/parameterized functions for repeated patterns
- Use protocol extensions for shared behavior
- Apply DRY, but don't over-abstract (see Over-Abstraction above)
