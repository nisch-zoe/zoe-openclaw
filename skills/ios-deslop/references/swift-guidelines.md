# Swift & iOS Guidelines for Deslopping

## Table of Contents
1. [Naming Conventions](#naming-conventions)
2. [Code Organization](#code-organization)
3. [SwiftUI Patterns](#swiftui-patterns)
4. [Concurrency](#concurrency)
5. [Error Handling](#error-handling)
6. [Architecture](#architecture)
7. [Testing](#testing)
8. [Performance](#performance)

---

## Naming Conventions

Follow Apple's API Design Guidelines:

- **Clarity at the point of use** is the most important goal
- **Prefer clarity over brevity** — short names that sacrifice clarity are worse
- **Name methods for their side effects**: mutating verbs (`sort()`), non-mutating nouns (`sorted()`)
- Use `camelCase` for functions, properties, variables; `PascalCase` for types and protocols
- Boolean properties read as assertions: `isEmpty`, `isValid`, `hasContent`
- Factory methods begin with `make`: `makeIterator()`
- Protocols describing capability use `-able`, `-ible`, or `-ing`: `Equatable`, `Codable`
- Protocols describing what something is use nouns: `Collection`, `Sequence`

### Anti-patterns AI Produces
```swift
// ❌ AI slop: vague, generic names
let data = fetchData()
let result = processResult(data)
func handleAction(_ action: Action)
let manager = DataManager()

// ✅ Clear, specific names
let transactions = fetchRecentTransactions()
let summary = summarizeExpenses(transactions)
func applyDiscount(_ discount: Discount)
let transactionStore = TransactionStore()
```

---

## Code Organization

### File Structure
- One primary type per file
- Extensions for protocol conformances in separate `// MARK:` sections
- Group related functionality with `// MARK: -`
- Put `private` helpers at the bottom

### Access Control
- Default to `private` — only expose what's needed
- Use `internal` (the default) for module-internal APIs
- `public` only for framework/package APIs
- `fileprivate` is a code smell — usually means the file is doing too much

### Anti-patterns AI Produces
```swift
// ❌ Everything public/internal by default
class ExpenseManager {
    var expenses: [Expense] = []
    var totalAmount: Double = 0
    func recalculate() { ... }
}

// ✅ Minimal surface area
final class ExpenseManager {
    private(set) var expenses: [Expense] = []
    var totalAmount: Double { expenses.reduce(0) { $0 + $1.amount } }
}
```

---

## SwiftUI Patterns

### View Composition
- Keep views under ~40 lines; extract subviews
- Use `@ViewBuilder` for conditional content
- Prefer computed properties over methods for view fragments
- Use `.task` over `.onAppear` for async work

### State Management
- `@State` for view-local state only
- `@Binding` to share write access with child views
- `@Observable` class (Swift 5.9+) over `ObservableObject` for new code
- `@Environment` for dependency injection
- Never store derived state — compute it

### Anti-patterns AI Produces
```swift
// ❌ God view with everything inline
struct ContentView: View {
    @State var items: [Item] = []
    @State var isLoading = false
    @State var error: String?
    @State var searchText = ""
    @State var selectedItem: Item?
    @State var showDetail = false
    @State var showSettings = false
    // ... 200 lines of body
}

// ✅ Decomposed, focused views
struct ItemListView: View {
    @State private var viewModel = ItemListViewModel()

    var body: some View {
        List(viewModel.filteredItems) { item in
            ItemRow(item: item)
        }
        .searchable(text: $viewModel.searchText)
        .task { await viewModel.load() }
    }
}
```

---

## Concurrency

### Modern Swift Concurrency (prefer over GCD/callbacks)
- Use `async`/`await` for asynchronous code
- Use `Task {}` to bridge sync → async contexts
- Use `TaskGroup` for parallel work
- Mark shared mutable state with `@MainActor` or use actors
- Avoid `DispatchQueue.main.async` in new code — use `@MainActor`

### Anti-patterns AI Produces
```swift
// ❌ Mixing old and new concurrency
func loadData() {
    Task {
        let data = await fetchData()
        DispatchQueue.main.async {
            self.items = data
        }
    }
}

// ✅ Pure async/await
@MainActor
func loadData() async {
    items = await fetchData()
}
```

---

## Error Handling

- Use typed `throws` (Swift 6) when the error set is fixed
- Prefer `Result` for errors that need to be stored/passed
- Never silently swallow errors with `try?` unless intentional and documented
- Custom error types over `NSError` or string-based errors

### Anti-patterns AI Produces
```swift
// ❌ Silent failure
let data = try? await fetchData()
// What happens when this fails? Nobody knows.

// ❌ Generic error messages
throw NSError(domain: "", code: -1, userInfo: [NSLocalizedDescriptionKey: "Something went wrong"])

// ✅ Explicit handling
do {
    let data = try await fetchData()
    process(data)
} catch let error as NetworkError {
    showAlert(for: error)
} catch {
    logger.error("Unexpected error loading data: \(error)")
    showGenericError()
}
```

---

## Architecture

### Preferred Patterns
- **MVVM** for most SwiftUI apps — `@Observable` view models
- **TCA** for complex state management (if project uses it)
- Keep business logic out of views
- Dependency injection over singletons
- Protocol-oriented design for testability

### Anti-patterns AI Produces
```swift
// ❌ Singleton everything
class NetworkManager {
    static let shared = NetworkManager()
    // ...
}
// Used everywhere: NetworkManager.shared.fetch(...)

// ✅ Injectable dependency
protocol NetworkClient: Sendable {
    func fetch<T: Decodable>(_ request: URLRequest) async throws -> T
}

final class URLSessionNetworkClient: NetworkClient { ... }

// Injected via init or @Environment
```

---

## Testing

### Unit Tests
- Test behavior, not implementation
- Use Swift Testing framework (`@Test`, `#expect`) for new tests
- Use `@Suite` to group related tests
- Name tests descriptively: `@Test("Expense total excludes cancelled transactions")`

### UI Tests
- Test critical user flows only
- Use accessibility identifiers for element lookup
- Keep UI tests focused and fast

### Build & Test Commands
```bash
# Build the project
xcodebuild -scheme <SchemeName> -destination 'platform=iOS Simulator,name=iPhone 16' build

# Run tests
xcodebuild -scheme <SchemeName> -destination 'platform=iOS Simulator,name=iPhone 16' test

# Swift Package Manager (if applicable)
swift build
swift test

# SwiftLint (if configured)
swiftlint lint --strict
```

---

## Performance

- Use `lazy` properties for expensive initialization
- Prefer value types (structs) over reference types (classes) when possible
- Avoid unnecessary `AnyView` — use `@ViewBuilder` or `some View`
- Use `Equatable` conformance to optimize SwiftUI diffing
- Profile with Instruments before optimizing
