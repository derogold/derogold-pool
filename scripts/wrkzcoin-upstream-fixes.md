# wrkzcoin-multi-hashing — upstream fixes for Node 18+ / V8 10+

These are the permanent fixes that should be applied directly to the
`wrkzcoin-multi-hashing` source repo so that `npm install` works out of
the box on modern Node without the postinstall patching workaround in
`derogold-pool/scripts/patch-native-addons.js`.

The derogold-pool postinstall script applies these as text replacements
to `node_modules/`.  Applying them to the upstream source means they ship
already-correct and no patching is needed downstream.

---

## 1. `binding.gyp` — C++ standard

**Change:** `-std=c++0x` → `-std=c++17`

The old standard alias `c++0x` is a pre-standardisation name for C++11.
C++14 is the minimum needed for `std::remove_cv_t`; C++17 is fine for
this codebase and is what the derogold-pool patch targets.

```diff
-        "-std=c++0x",
+        "-std=c++17",
```

---

## 2. `multihashing.cc` — five V8 API changes

All of these were breaking changes introduced between Node 8's V8 and
Node 10/12's V8, and they are still required on Node 18+.

### 2a. `String::NewFromUtf8` — now returns `MaybeLocal<String>` (1 occurrence)

The old overload returned `Local<String>` directly.  Now you must call
`.ToLocalChecked()` (or handle the Maybe) to unwrap it.

```diff
-    isolate->ThrowException(Exception::Error(String::NewFromUtf8(isolate, msg)));
+    isolate->ThrowException(Exception::Error(String::NewFromUtf8(isolate, msg).ToLocalChecked()));
```

The pattern is inside a macro near the top of the file.  Search for
`NewFromUtf8(isolate, msg))` (note the double closing paren — one from
`NewFromUtf8`, one from `Exception::Error`).

### 2b. `->ToObject()` — zero-argument overload removed (16 occurrences)

V8 removed the no-context overload.  The context must be passed explicitly.

```diff
-    Local<Object> target = args[0]->ToObject();
+    Local<Object> target = args[0]->ToObject(isolate->GetCurrentContext()).ToLocalChecked();
```

Also applies to `args[1]->ToObject()` (the boolberry two-target function
has both `args[0]` and `args[1]`).

### 2c. `->Uint32Value()` — zero-argument overload removed (16 occurrences)

```diff
-    unsigned int nValue = args[1]->Uint32Value();
+    unsigned int nValue = args[1]->Uint32Value(isolate->GetCurrentContext()).FromJust();
```

Affects every place an argument is read as an unsigned integer (n, r,
height, soft-shell window/memory/multiplier, cn_variant, etc.).

### 2d. `->Int32Value()` — zero-argument overload removed (4 occurrences)

```diff
-    int timestamp = args[1]->Int32Value();
+    int timestamp = args[1]->Int32Value(isolate->GetCurrentContext()).FromJust();
```

Only used in the `scryptjane` function (timestamp, nChainStartTime, nMin,
nMax arguments).

### 2e. `->BooleanValue()` — signature changed (8 occurrences)

No longer zero-argument; now takes the isolate (not a context).

```diff
-    fast = args[1]->BooleanValue();
+    fast = args[1]->BooleanValue(isolate);
```

Appears in the `fast` flag check inside each cryptonight variant function.

---

## Quick verification after applying

```bash
node-gyp rebuild
# Should end with:  gyp info ok

node -e "
  const h = require('./build/Release/multihashing');
  const buf = Buffer.from('a'.repeat(64));
  console.log(h.cryptonight(buf, 0).toString('hex'));
"
# Should print a 64-char hex hash without throwing
```

Or, from the derogold-pool directory after `npm install --ignore-scripts`:

```bash
node tests/dependencyTests.js
# All 54 tests should pass
```

---

## Context

- Discovered while modernising `derogold-pool` to run on Node 18/22.
- The derogold-pool postinstall workaround is in
  `scripts/patch-native-addons.js` — once these fixes land upstream,
  the wrkzcoin-multi-hashing section of that script can be removed.
- `turtlecoin-cryptonote-util` needs a similar `binding.gyp` fix
  (`-std=c++0x` → `-std=c++14`; **not** c++17 — that breaks
  `binary_archive.h`).
- `cryptonight-hashing` (uPlexa fork) uses NAN so the `->ToObject()`
  fix there is `->ToObject(Nan::GetCurrentContext()).ToLocalChecked()`
  — no bare `isolate` variable in `NAN_METHOD` scope.
