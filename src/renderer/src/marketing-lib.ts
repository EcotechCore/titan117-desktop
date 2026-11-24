// The content calendar's month grid (phase 14), kept apart from the screen so it can be tested.

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The weeks of a month, Monday first; days outside the month are null. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1)
  const days = new Date(year, month + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  const cells: (string | null)[] = [
    ...new Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`)
  ]
  while (cells.length % 7) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}
