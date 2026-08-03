# Tests

`npm test` (from the repo root) runs everything with Node's built-in runner —
no test framework, no extra dependencies:

```
node --test tests/*.test.js
```

| file | what it protects |
|---|---|
| `one-version.test.js` | the "one single version" clean-up: one bottom bar, one price source, one card API, one payment prefix, the `--sg-z-*` layer scale, and the routes we deleted staying deleted |
| `routes.test.js` | no two routers answer the same path on `/api/payment`, `/api/pricing`, `/api/stats`; the card endpoints still exist |
| `self-check.test.js` | the key watchdog alerts once per outage and once on recovery (fake probes, no network) |
| `syntax.test.js` | every shipped `.js` parses — the frontend has no build step, so a typo is a white screen |

Add a test whenever you delete a duplicate: the test is what stops it growing back.
