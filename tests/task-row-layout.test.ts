import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')

const ruleBody = (source: string, selector: string) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  expect(match, `Expected a CSS rule for ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

const appliedUtilities = (body: string) => body
  .match(/@apply\s+([^;]+);/)?.[1]
  .trim()
  .split(/\s+/) ?? []

describe('task row responsive layout', () => {
  it('constrains the title control to its shrinking grid column', () => {
    const utilities = appliedUtilities(ruleBody(styles, '.task-title-button'))

    expect(utilities).toContain('w-full')
    expect(utilities).toContain('min-w-0')
  })

  it('wraps task actions after they move below the title on compact screens', () => {
    const compactStyles = styles.slice(
      styles.indexOf('@media (max-width: 620px)'),
      styles.indexOf('@media (max-width: 860px)', styles.indexOf('@media (max-width: 620px)')),
    )
    const utilities = appliedUtilities(ruleBody(compactStyles, '.task-actions'))

    expect(utilities).toContain('flex-wrap')
  })

  it('reserves space between task select text and the native dropdown arrow', () => {
    const utilities = appliedUtilities(ruleBody(styles, '.task-assignee'))

    expect(utilities).toContain('pl-2')
    expect(utilities).toContain('pr-7')
  })
})
