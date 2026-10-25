/**
 * Scoring for the command palette. Kept here as pure functions so the ranking can be tested
 * without a DOM: the composable and the component only deal with keyboard and focus.
 *
 * Higher is better; `null` means the candidate does not match at all and must not be shown.
 * The bands are far apart on purpose, so a title match always outranks a keyword match no
 * matter how the within-band penalties fall.
 */

const EXACT = 1000
const PREFIX = 800
const WORD_PREFIX = 600
const SUBSTRING = 400
const SUBSEQUENCE = 200

/** Characters that start a new word for matching purposes, so "cp" finds "Create project". */
const WORD_BOUNDARY = /[\s\-_/:.,()]/

export const normalizeQuery = (value: string): string => value.trim().toLowerCase()

/**
 * Scores one string against the query. The length penalty is what makes "Inbox" beat
 * "Inbox view options" for the query "inbox" -- a shorter match is a more specific one.
 */
export const scoreMatch = (query: string, candidate: string): number | null => {
  const needle = normalizeQuery(query)
  const haystack = candidate.toLowerCase()
  if (!needle) return 1
  if (!haystack) return null

  const penalty = Math.min(haystack.length, 99)

  if (haystack === needle) return EXACT
  if (haystack.startsWith(needle)) return PREFIX - penalty

  // Any word starting with the query: "pro" matches the "Projects" in "Go to Projects".
  let boundary = 0
  while (boundary < haystack.length) {
    if (haystack.startsWith(needle, boundary)) {
      const previous = boundary === 0 ? ' ' : haystack[boundary - 1] ?? ' '
      if (WORD_BOUNDARY.test(previous)) return WORD_PREFIX - penalty
      break
    }
    boundary += 1
  }

  if (haystack.includes(needle)) return SUBSTRING - penalty

  // Subsequence: every needle character appears in order, which is how initialisms such as
  // "ctp" reach "Create task in project". Gaps are charged for, so tight matches rank first.
  let cursor = 0
  let gaps = 0
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor)
    if (found === -1) return null
    gaps += found - cursor
    cursor = found + 1
  }
  return SUBSEQUENCE - Math.min(gaps, 150)
}

export type ScorableAction = {
  label: string
  /** Extra terms that should find this action but are not worth showing in the list. */
  keywords?: string[]
  /** Shown as the list section, and matched so "goal" finds everything under "Goals". */
  group?: string
}

/**
 * The best score across an action's label, group and keywords. A keyword or group hit is pushed
 * below every title hit, so typing a word that appears in one action's title and another's
 * keywords always puts the title first.
 */
export const scoreAction = (query: string, action: ScorableAction): number | null => {
  const labelScore = scoreMatch(query, action.label)
  if (labelScore !== null) return labelScore

  const secondary = [action.group ?? '', ...(action.keywords ?? [])]
    .map(term => scoreMatch(query, term))
    .filter((score): score is number => score !== null)

  if (secondary.length === 0) return null
  // `- EXACT` keeps the whole secondary band beneath the weakest possible label match.
  return Math.max(...secondary) - EXACT
}

/**
 * Filters to matching actions and orders them best-first. Ties break on label so the list does
 * not reshuffle between keystrokes that score the same.
 */
export const rankActions = <T extends ScorableAction>(query: string, actions: T[]): T[] => {
  return actions
    .map(action => ({ action, score: scoreAction(query, action) }))
    .filter((entry): entry is { action: T, score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.action.label.localeCompare(b.action.label))
    .map(entry => entry.action)
}
