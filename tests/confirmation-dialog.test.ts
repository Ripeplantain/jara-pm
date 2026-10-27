import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const app = readSource('app/app.vue')
const host = readSource('app/components/common/ConfirmationHost.vue')
const confirmation = readSource('app/composables/useConfirmation.ts')
const taskRow = readSource('app/components/tasks/TaskRow.vue')
const settings = readSource('app/pages/settings.vue')
const statusEditor = readSource('app/components/settings/StatusEditor.vue')

const section = (source: string, start: string, end: string) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `Expected to find section start: ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `Expected to find section end: ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

const expectConfirmedBefore = (source: string, sideEffect: string) => {
  const confirmationIndex = source.indexOf('await confirmAction(')
  const guardIndex = source.indexOf('if (!accepted) return')
  const sideEffectIndex = source.indexOf(sideEffect)

  expect(confirmationIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeGreaterThan(confirmationIndex)
  expect(sideEffectIndex).toBeGreaterThan(guardIndex)
}

describe('global confirmation dialog', () => {
  it('is mounted once at the app root and rendered outside the inert application tree', () => {
    expect(app).toContain('<ConfirmationHost />')
    expect(host).toContain('<Teleport to="body">')
    expect(host).toContain("document.getElementById('__nuxt')")
    expect(host).toContain('appRoot.inert = open')
    expect(host).toContain('appRoot.inert = false')
  })

  it('exposes an labelled modal alert with explicit cancel and destructive actions', () => {
    expect(host).toContain('role="alertdialog"')
    expect(host).toContain('aria-modal="true"')
    expect(host).toContain(':aria-labelledby="titleId"')
    expect(host).toContain(':aria-describedby="descriptionId"')
    expect(host).toContain('<h2 :id="titleId"')
    expect(host).toContain('<p :id="descriptionId"')
    expect(host).toContain('ref="cancelButton"')
    expect(host).toContain('class="button danger"')
  })

  it('focuses Cancel first, traps both Tab directions, and supports Escape and backdrop cancellation', () => {
    expect(host).toContain('cancelButton.value?.focus()')
    expect(host).toContain("event.key === 'Escape'")
    expect(host).toContain("event.key !== 'Tab'")
    expect(host).toContain('event.shiftKey && document.activeElement === first')
    expect(host).toContain('last.focus()')
    expect(host).toContain('!event.shiftKey && document.activeElement === last')
    expect(host).toContain('first.focus()')
    expect(host).toContain('@pointerdown.self="cancel"')
  })

  it('restores the invoking control and resolves cancellation without accepting the action', () => {
    expect(confirmation).toContain('const previouslyFocused = document.activeElement instanceof HTMLElement')
    expect(confirmation).toContain('if (previouslyFocused?.isConnected) previouslyFocused.focus()')
    expect(confirmation).toContain('cancel: () => respond(false)')
    expect(confirmation).toContain('accept: () => respond(true)')
  })
})

describe('persisted destructive actions', () => {
  it('confirms task deletion before hiding it and retains the delayed DELETE with Undo', () => {
    const remove = section(taskRow, 'const remove = async () => {', '\nconst onLabelUpdated')

    expectConfirmedBefore(remove, 'hideTask(props.task.id)')
    expect(remove).toContain('showUndo({')
    expect(remove).toContain("method: 'DELETE'")
    expect(remove).toContain('onUndo: () => revealTask(props.task.id)')
  })

  it('confirms invitation revocation before its DELETE request', () => {
    const revoke = section(settings, 'const revoke = async', '\nconst removeMember')
    expectConfirmedBefore(revoke, "method: 'DELETE'")
  })

  it('confirms member removal before its DELETE request', () => {
    const removeMember = section(settings, 'const removeMember = async', '\nconst logout')
    expectConfirmedBefore(removeMember, "method: 'DELETE'")
  })

  it('confirms sign-out before clearing the session and navigating away', () => {
    const logout = section(settings, 'const logout = async', '\nconst chooseTheme')

    expectConfirmedBefore(logout, 'await clear()')
    expect(logout.indexOf('await navigateTo(\'/welcome\')')).toBeGreaterThan(logout.indexOf('await clear()'))
    expect(logout).toContain('finally {')
    expect(logout.indexOf('isLoggingOut.value = false')).toBeGreaterThan(logout.indexOf('finally {'))
  })

  it('confirms permanent label deletion before removing the label', () => {
    const deleteLabel = section(settings, 'const deleteLabel = async', '\nconst toggleArchivedLabels')
    expectConfirmedBefore(deleteLabel, 'await removeLabel(label.id)')
  })

  it('keeps replacement selection and confirms status deletion before the request', () => {
    const confirmDelete = section(statusEditor, 'const confirmDelete = async', '\n</script>')

    expect(confirmDelete).toContain('replacementId.value')
    expect(confirmDelete).toContain('tasks will be moved')
    expectConfirmedBefore(confirmDelete, 'await deleteStatus(')
    expect(statusEditor).toContain('<select v-model="replacementId"')
  })
})
