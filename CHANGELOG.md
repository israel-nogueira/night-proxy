# Changelog

All notable changes to shadow-proxy are documented here.

---

## [2.7.2] — 2024

### 🔒 Security — Breaking-adjacent

**Replaced `new Function` / `eval` with a custom AST parser + interpreter.**

The previous sandbox relied on a token-level blocklist (`_validateTokens`) that could be bypassed via bracket notation with string literals — e.g. `a['constructor']` tokenizes as `'str'`, which the old check never inspected.

The new engine (`_parseAST` / `_Interpreter`) walks an AST and validates **every property access** — dot or bracket, literal or dynamic — against `_assertSafeProp()` **at runtime**, after the key value has been fully resolved. The attack surface covered:

- `a['constructor']` → blocked
- `a['con' + 'structor']` → blocked
- `a[varContainingDangerousName]` → blocked
- Arrow functions (`=>`) → blocked at parse time
- `Object.getPrototypeOf(obj)` and other prototype-introspection methods (`setPrototypeOf`, `getOwnPropertyDescriptor(s)`, `defineProperty(ies)`, `create`) → blocked. These reach the same prototype chain as `constructor`/`__proto__` but under a different property name, so they weren't covered by the original blocklist.

Zero `new Function` / `eval` calls remain in the codebase. The library now works under strict CSP (`script-src` without `unsafe-eval`).

**Error messages from expression failures now come from the custom parser** — syntax error wording may differ from previous versions.

New error type added: `security-blocked` (fired when the interpreter blocks a dangerous property access at runtime).

### ✨ Features

- **Early template cache** (`_cacheTemplates` now called in `initProxy`) — `x-for` with empty arrays no longer loses the template on first render.
- **Centralized error reporting** — all internal errors go through `_reportError`. Set `proxy.onError` to capture them globally.

### 🐛 Fixes

- `with($s)` removed — expressions are now evaluated by the interpreter directly against the scope object.
- Duplicate re-render when 2+ props of the same effect changed in the same tick — fixed by always scheduling effects via microtask (no more synchronous single-effect shortcut).
- **`_setDeep` fallback bypassed reactivity.** When `_proxies[key]` didn't exist yet (e.g. an orphan `x-model` element writing after its component's `destroy()`), the old fallback wrote straight into `_store`, skipping the proxy `set` trap entirely — no `_trigger`, no watcher notification. Fixed by always ensuring the proxy exists before writing, same lazy-create logic used by the `template` getter.

### 🧪 Tests

- **154 tests** (was 152) — added coverage for the `Object.getPrototypeOf` bypass attempt in the security sandbox, and for the orphan `x-model` write-after-destroy now going through the reactive proxy.

---

## [2.5.x] — previous

See inline comments in `shadow-proxy` header for prior change history.