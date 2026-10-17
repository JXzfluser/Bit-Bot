///|
test "cloud agent job placeholder" {
  let job = @cloud.CloudAgentJob::queued("job-1", "run eval")
  assert_eq(job.is_terminal(), false)
  assert_eq(job.status, @cloud.Queued)
}
