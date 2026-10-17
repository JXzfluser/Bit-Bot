///|
/// CM-0302: journal layer — query by date range; does not pollute profile.
test "acceptance_CM-0302_journal_range_query_no_profile_pollute" {
  let j = @memory.JournalStore::new()
  j.append(date="2026-10-10", event_id="e1", body="started N planning")
  j.append(date="2026-10-12", event_id="e2", body="P0 closed")
  j.append(date="2026-10-15", event_id="e3", body="N-batch scaffolding")
  j.append(date="2026-10-17", event_id="e4", body="acceptance tests")

  // Journal append must not pollute profile.
  assert_false(j.journal_pollutes_profile())
  assert_eq(j.profile_keys().length(), 0)

  let mid = j.query_range(from_date="2026-10-12", to_date="2026-10-16")
  assert_eq(mid.length(), 2)
  assert_eq(mid[0].event_id, "e2")
  assert_eq(mid[1].event_id, "e3")
  assert_eq(mid[0].body, "P0 closed")

  let all = j.query_range(from_date="2026-10-01", to_date="2026-10-31")
  assert_eq(all.length(), 4)

  let empty = j.query_range(from_date="2026-09-01", to_date="2026-09-30")
  assert_eq(empty.length(), 0)

  // Still no profile pollution after queries.
  assert_false(j.journal_pollutes_profile())

  // Explicit profile write is independent.
  j.update_profile(key="favorite_color", value="teal")
  assert_eq(j.profile_keys().length(), 1)
  // Journal range unchanged by profile write.
  assert_eq(
    j.query_range(from_date="2026-10-12", to_date="2026-10-16").length(),
    2,
  )
}
