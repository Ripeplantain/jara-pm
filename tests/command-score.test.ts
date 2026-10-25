import { describe, expect, it } from 'vitest'
import { normalizeQuery, rankActions, scoreAction, scoreMatch } from '../shared/utils/command-score'

describe('scoreMatch', () => {
  it('matches everything when the query is blank', () => {
    expect(scoreMatch('', 'Anything')).not.toBeNull()
    expect(scoreMatch('   ', 'Anything')).not.toBeNull()
  })

  it('rejects a candidate with no match', () => {
    expect(scoreMatch('zzz', 'Go to Inbox')).toBeNull()
  })

  it('ranks exact above prefix above word prefix above substring', () => {
    const exact = scoreMatch('inbox', 'Inbox')
    const prefix = scoreMatch('inb', 'Inbox tasks')
    const wordPrefix = scoreMatch('inb', 'Go to Inbox')
    const substring = scoreMatch('nbo', 'Go to Inbox')

    expect(exact).toBeGreaterThan(prefix!)
    expect(prefix).toBeGreaterThan(wordPrefix!)
    expect(wordPrefix).toBeGreaterThan(substring!)
  })

  it('prefers the shorter of two prefix matches', () => {
    expect(scoreMatch('inbox', 'Inbox')).toBeGreaterThan(scoreMatch('inbox', 'Inbox view options')!)
  })

  it('is case and whitespace insensitive', () => {
    expect(scoreMatch('  INBOX  ', 'inbox')).toBe(scoreMatch('inbox', 'Inbox'))
  })

  it('matches an initialism as a subsequence', () => {
    expect(scoreMatch('ctp', 'Create task in project')).not.toBeNull()
  })

  it('requires the query characters in order', () => {
    expect(scoreMatch('ct', 'Create task')).not.toBeNull()
    // No `c` after the `t`, so the reverse is not a subsequence.
    expect(scoreMatch('tc', 'Create task')).toBeNull()
  })

  it('charges for gaps so a tighter subsequence wins', () => {
    const tight = scoreMatch('cre', 'Create goal')
    const loose = scoreMatch('cre', 'Complete reading everything')

    expect(tight).toBeGreaterThan(loose!)
  })

  it('treats a hyphen or slash as a word boundary', () => {
    expect(scoreMatch('key', 'task-key settings')).toBe(scoreMatch('key', 'task key settings'))
  })
})

describe('scoreAction', () => {
  // The bands must not overlap: a title hit always beats a keyword hit, however weak.
  it('ranks any label match above any keyword match', () => {
    const byLabel = scoreAction('dark', { label: 'Toggle dark mode' })
    const byKeyword = scoreAction('dark', { label: 'Appearance', keywords: ['dark'] })

    expect(byLabel).toBeGreaterThan(byKeyword!)
  })

  it('finds an action through its keywords', () => {
    expect(scoreAction('logout', { label: 'Sign out', keywords: ['logout', 'exit'] })).not.toBeNull()
  })

  it('finds an action through its group', () => {
    expect(scoreAction('navigation', { label: 'Inbox', group: 'Navigation' })).not.toBeNull()
  })

  it('rejects an action that matches nothing', () => {
    expect(scoreAction('xyz', { label: 'Inbox', group: 'Navigation', keywords: ['tasks'] })).toBeNull()
  })
})

describe('rankActions', () => {
  const actions = [
    { label: 'Go to Inbox', group: 'Navigation' },
    { label: 'Inbox', group: 'Navigation' },
    { label: 'Create project', group: 'Create', keywords: ['new'] },
    { label: 'Create goal', group: 'Create', keywords: ['new'] },
    { label: 'Toggle theme', group: 'Preferences', keywords: ['dark', 'light'] },
  ]

  it('returns every action for a blank query', () => {
    expect(rankActions('', actions)).toHaveLength(actions.length)
  })

  it('drops actions that do not match', () => {
    expect(rankActions('inbox', actions).map(action => action.label))
      .toEqual(['Inbox', 'Go to Inbox'])
  })

  it('puts the most specific match first', () => {
    expect(rankActions('inb', actions)[0]?.label).toBe('Inbox')
  })

  it('breaks ties on label so the list does not reshuffle between keystrokes', () => {
    expect(rankActions('create', actions).map(action => action.label))
      .toEqual(['Create goal', 'Create project'])
  })

  it('finds an action by a keyword none of the labels contain', () => {
    expect(rankActions('dark', actions).map(action => action.label)).toEqual(['Toggle theme'])
  })

  it('returns nothing when the query matches nothing', () => {
    expect(rankActions('zzzz', actions)).toEqual([])
  })
})

describe('normalizeQuery', () => {
  it('trims and lowercases', () => {
    expect(normalizeQuery('  Create Task ')).toBe('create task')
  })
})
