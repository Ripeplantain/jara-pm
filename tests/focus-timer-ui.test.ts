import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const card = readSource('app/components/tasks/NowCard.vue')
const preference = readSource('app/composables/useFocusDuration.ts')

const section = (source: string, start: string, end: string) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `Expected to find section start: ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `Expected to find section end: ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('editable focus timer duration', () => {
  it('renders a labelled bounded whole-minute control that locks only while running', () => {
    const durationControl = section(card, '<label class="now-timer-duration">', '\n      </label>')

    expect(durationControl).toContain('<span>Minutes</span>')
    expect(durationControl).toContain('type="number"')
    expect(durationControl).toContain(':min="MIN_FOCUS_MINUTES"')
    expect(durationControl).toContain(':max="MAX_FOCUS_MINUTES"')
    expect(durationControl).toContain('step="1"')
    expect(durationControl).toContain(':disabled="isRunning"')
    expect(durationControl).toContain('@change="changeDuration"')
  })

  it('starts a fresh stopped session when the duration changes', () => {
    const changeDuration = section(card, 'const changeDuration = (event: Event) => {', '\n}\n\nconst isUntouched')

    expect(changeDuration.indexOf('setMinutes(input.value)')).toBeGreaterThanOrEqual(0)
    expect(changeDuration.indexOf('resetTimer()')).toBeGreaterThan(changeDuration.indexOf('setMinutes(input.value)'))
  })

  it('uses the selected duration for reset, task changes, and restart after completion', () => {
    const startTimer = section(card, 'const startTimer = () => {', '\n}\n\nconst pauseTimer')
    const resetTimer = section(card, 'const resetTimer = () => {', '\n}\n\nconst changeDuration')

    expect(card).toContain('const sessionSeconds = computed(() => focusDurationSeconds(durationMinutes.value))')
    expect(startTimer).toContain('if (remaining.value <= 0) remaining.value = sessionSeconds.value')
    expect(resetTimer).toContain('remaining.value = sessionSeconds.value')
    expect(card).toContain('watch(() => props.task.id, resetTimer)')
  })

  it('retains remaining progress across pause and resume', () => {
    const startTimer = section(card, 'const startTimer = () => {', '\n}\n\nconst pauseTimer')
    const pauseTimer = section(card, 'const pauseTimer = () => {', '\n}\n\nconst resetTimer')

    expect(startTimer).toContain('endsAt = Date.now() + remaining.value * 1000')
    expect(pauseTimer).toContain('remaining.value = secondsRemaining(endsAt, Date.now())')
    expect(pauseTimer).toContain('stopTicking()')
  })

  it('persists only the validated preference through guarded local storage', () => {
    expect(preference).toContain("const STORAGE_KEY = 'kobi-focus-duration-minutes'")
    expect(preference).toContain('localStorage.getItem(STORAGE_KEY)')
    expect(preference).toContain('localStorage.setItem(STORAGE_KEY, String(minutes.value))')
    expect(preference).toContain('isFocusDurationMinutes(parsed) ? parsed : DEFAULT_FOCUS_MINUTES')
    expect(preference.match(/try \{/g)?.length).toBe(2)
    expect(preference.match(/catch \{/g)?.length).toBe(2)
    expect(preference).not.toContain('remaining')
    expect(preference).not.toContain('task')
  })
})
