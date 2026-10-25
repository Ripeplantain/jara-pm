const KEY_BODY = /^[A-Z][A-Z0-9]{0,4}$/
const TASK_KEY = /^([A-Z][A-Z0-9]{0,4})-([1-9][0-9]*)$/
const TASK_KEY_MENTION = /\b[A-Z][A-Z0-9]{0,4}-[1-9][0-9]*\b/g

export const MAX_WORKSPACE_KEY_LENGTH = 5

export const isWorkspaceKey = (value: string): boolean => KEY_BODY.test(value)

export const formatTaskKey = (workspaceKey: string, taskNumber: number): string =>
  `${workspaceKey}-${taskNumber}`

export const parseTaskKey = (value: string): { workspaceKey: string, taskNumber: number } | null => {
  const match = TASK_KEY.exec(value.trim())
  if (!match) return null
  const taskNumber = Number(match[2])
  if (!Number.isSafeInteger(taskNumber)) return null
  return { workspaceKey: match[1] as string, taskNumber }
}

// An uppercase prefix of the name, 'W' when the name does not start with a letter, then a
// numeric suffix for collisions. Digits are permitted after the first character so the suffix
// always fits inside five characters.
//
// The 0006 backfill assigns pre-existing workspaces a single-letter base instead, because SQL
// cannot take a word prefix as cheaply; both forms satisfy `workspaces_key_check` and the
// UNIQUE index, so old and new workspaces simply carry differently shaped keys.
export const deriveWorkspaceKey = (name: string, taken: Iterable<string> = []): string => {
  const reserved = new Set<string>()
  for (const value of taken) reserved.add(value.toUpperCase())

  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const base = /^[A-Z]/.test(letters)
    ? letters.slice(0, MAX_WORKSPACE_KEY_LENGTH)
    : 'W'

  if (!reserved.has(base)) return base

  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const room = MAX_WORKSPACE_KEY_LENGTH - String(suffix).length
    const candidate = `${base.slice(0, Math.max(1, room))}${suffix}`
    if (candidate.length <= MAX_WORKSPACE_KEY_LENGTH && !reserved.has(candidate)) return candidate
  }

  throw new Error('Unable to derive a unique workspace key')
}

// Deduped so that re-reading the same text never produces duplicate references. Slice D1 relies
// on this being idempotent.
export const extractTaskKeys = (text: string): string[] => [...new Set(text.match(TASK_KEY_MENTION) ?? [])]

export type TaskTextSegment = {
  text: string
  /** The task key this segment links to, or `null` for ordinary text. */
  key: string | null
}

/**
 * Splits text into plain runs and task-key mentions so a template can render the mentions as
 * links without interpolating HTML. Concatenating every `text` reproduces the input exactly,
 * which is what keeps the rendered description faithful to what was typed.
 */
export const splitTaskKeyMentions = (text: string): TaskTextSegment[] => {
  const segments: TaskTextSegment[] = []
  let cursor = 0
  // `TASK_KEY_MENTION` is a module-level global regex, so its lastIndex is reset per call
  // rather than shared between callers.
  const pattern = new RegExp(TASK_KEY_MENTION.source, 'g')
  let match = pattern.exec(text)
  while (match) {
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), key: null })
    segments.push({ text: match[0], key: match[0] })
    cursor = match.index + match[0].length
    match = pattern.exec(text)
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), key: null })
  return segments
}
