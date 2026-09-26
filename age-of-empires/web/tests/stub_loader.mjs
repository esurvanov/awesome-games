// Node loader for testing a ported module before its dependencies are ported:
//   node --import ./web/tests/stub_loader.mjs --test web/tests/test_<yours>.mjs
// A missing web/src/<m>.js (or web/src/content/<m>.js) is replaced by an automatic stub generated from
// game/<m>.py: every top-level `def`/`class` becomes a function that throws "not ported yet" when called,
// every top-level NAME = ... becomes `undefined`. Linking succeeds; only code paths that really use the missing
// module fail. Never ship anything that depends on stubs.
import module from 'node:module';
import { resolveSync, loadSync } from './stub_hooks.mjs';

if (module.registerHooks) module.registerHooks({ resolve: resolveSync, load: loadSync });
else module.register('./stub_hooks.mjs', import.meta.url);
