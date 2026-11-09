## What and why



## Checklist (guardrails §15)

- [ ] Typecheck, lint, tests and build pass
- [ ] New gated functions or tools have denial tests
- [ ] Seen working in the real app (say where, and what wasn't checked)
- [ ] No secrets, keys or personal data in code, logs or fixtures
- [ ] New tables have a row in the data table
- [ ] New dependencies: licence allowed, no known vulnerabilities, sources list updated if code was copied
- [ ] Protocol changes are backward compatible and versioned
- [ ] Third-party services used: their row in `external-services.md` is checked against the vendor's docs (§11b)
- [ ] `progress.md` and docs updated
