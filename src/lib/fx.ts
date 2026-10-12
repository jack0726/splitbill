/** Latest reference rate: how many `to` units one `from` unit buys. Returns null if unavailable. */
export async function fetchRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`)
    if (!res.ok) return null
    const json = (await res.json()) as { rates?: Record<string, number> }
    return json.rates?.[to] ?? null
  } catch {
    return null
  }
}
