# Short concrete style (COMM-05 / CM-2156)

Product copy constraints — sampleable, not empty fluff.

## Rules (measurable)

1. **Non-empty**: body length ≥ 1 after trim.
2. **Concrete**: name a noun/verb the user can act on (file, path, command, decision, count).
3. **Short**: prefer ≤ 120 characters for a single ack / cue line.
4. **No fluff markers**: reject stock empty phrases such as
   `leverage synergies`, `circle back`, `going forward`, `touch base`,
   `at the end of the day`, `it is what it is`.
5. **Sampleable**: every rule above has a pass/fail fixture in
   `runtime/acceptance_cm2156_test.mbt`.

## Pass samples

- `Opened PR #12 on org/repo; waiting on CI.`
- `Installed ripgrep via Shell (apt); ready to search.`
- `Need your pick: ship or defer.`

## Fail samples

- `` (empty)
- `Leverage synergies going forward.`
- `Just circling back to touch base.`
