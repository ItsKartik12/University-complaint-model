// Ensures the synthetic development dataset exists through the running worker.
// The endpoint is development-only and inserts missing rows without deleting
// anything, so this command is safe to run repeatedly.
const base = (process.env.ACICS_DEV_URL || 'http://localhost:5173').replace(/\/+$/, '')

try {
  const res = await fetch(`${base}/api/dev/seed`, {
    method: 'POST',
    headers: { Origin: base },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    console.error(`Seed failed (${res.status}): ${data?.error ?? 'unknown error'}`)
    process.exit(1)
  }
  console.log(`${data.label}: ${data.message}`)
  console.log(
    `complaints=${data.counts.complaints} users=${data.counts.users} institutions=${data.counts.institutions}`,
  )
} catch {
  console.error(`Could not reach ${base}. Start the dev server first: bun run dev`)
  process.exit(1)
}
