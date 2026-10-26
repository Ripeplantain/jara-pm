import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLabels } from '../app/composables/useLabels'
import { useStatuses } from '../app/composables/useStatuses'
import { useWorkspaceMembers } from '../app/composables/useWorkspaceMembers'
import { useWorkspaces } from '../app/composables/useWorkspaces'

type FetchOptions = {
  key?: string
  default?: () => unknown
  dedupe?: 'cancel' | 'defer'
}

type FetchCall = {
  url: string
  options: FetchOptions
}

const fetchCalls: FetchCall[] = []
const reloadCalls: string[] = []
let routePath = '/'
let routeFullPath = '/'

const fetchResult = (options: FetchOptions) => ({
  data: ref(options.default?.()),
  error: ref(null),
  status: ref('success'),
  refresh: vi.fn(async (executeOptions?: { dedupe?: 'cancel' | 'defer' }) => {
    reloadCalls.push(`workspace-refresh:${executeOptions?.dedupe ?? 'default'}`)
  }),
})

beforeEach(() => {
  fetchCalls.length = 0
  reloadCalls.length = 0
  routePath = '/'
  routeFullPath = '/'
  const state = new Map<string, ReturnType<typeof ref>>()

  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useFetch', vi.fn((url: string, options: FetchOptions) => {
    fetchCalls.push({ url, options })
    return fetchResult(options)
  }))
  vi.stubGlobal('useState', vi.fn((key: string, initial: () => unknown) => {
    if (!state.has(key)) state.set(key, ref(initial()))
    return state.get(key)
  }))
  vi.stubGlobal('useAskKobi', () => ({ reset: vi.fn() }))
  vi.stubGlobal('useOptimisticTask', () => ({ resetOverlay: vi.fn() }))
  vi.stubGlobal('onMounted', vi.fn())
  vi.stubGlobal('useRoute', () => ({ path: routePath, fullPath: routeFullPath }))
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    reloadCalls.push(`post:${url}`)
    return {}
  }))
  vi.stubGlobal('clearNuxtData', vi.fn(async () => {
    reloadCalls.push('clear')
  }))
  vi.stubGlobal('navigateTo', vi.fn(async () => {
    reloadCalls.push('navigate')
  }))
  vi.stubGlobal('nextTick', vi.fn(async () => {
    reloadCalls.push('next-tick')
  }))
  vi.stubGlobal('refreshNuxtData', vi.fn(async () => {
    reloadCalls.push('global-refresh')
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const expectSharedFetch = (invoke: () => unknown, expectedUrl: string, expectedKey: string) => {
  invoke()
  invoke()

  const matching = fetchCalls.filter(call => call.options.key === expectedKey)
  expect(matching).toHaveLength(2)
  expect(matching.map(call => call.url)).toEqual([expectedUrl, expectedUrl])
  expect(matching.map(call => call.options.dedupe)).toEqual(['defer', 'defer'])
  expect(matching[1]?.options.default).toBe(matching[0]?.options.default)
}

describe('shared workspace fetches', () => {
  it('joins repeated workspace requests to the in-flight request', () => {
    expectSharedFetch(useWorkspaces, '/api/workspaces', 'workspace-list')
  })

  it('joins repeated status requests and uses one shared default factory', () => {
    expectSharedFetch(useStatuses, '/api/statuses', 'workspace-statuses')
  })

  it('joins repeated label requests and uses one shared default factory', () => {
    expectSharedFetch(useLabels, '/api/labels', 'label-collection')
  })

  it('joins repeated member requests and uses one shared default factory', () => {
    expectSharedFetch(useWorkspaceMembers, '/api/workspace/members', 'workspace-members-task-list')
  })

  it('refreshes mounted data without navigating when already on exact Today', async () => {
    routePath = '/'
    routeFullPath = '/'
    const { activateWorkspace } = useWorkspaces()

    await activateWorkspace('workspace-next')

    expect(reloadCalls).toEqual([
      'post:/api/workspaces/workspace-next/activate',
      'clear',
      'global-refresh',
    ])
    expect(reloadCalls).not.toContain('navigate')
    expect(reloadCalls).not.toContain('next-tick')
    expect(reloadCalls).not.toContain('workspace-refresh:defer')
  })

  it('clears a Today task-panel URL before refreshing mounted data', async () => {
    routePath = '/'
    routeFullPath = '/?task=S-1'
    const { activateWorkspace } = useWorkspaces()

    await activateWorkspace('workspace-next')

    expect(reloadCalls).toEqual([
      'post:/api/workspaces/workspace-next/activate',
      'clear',
      'navigate',
      'next-tick',
      'global-refresh',
    ])
    expect(reloadCalls).not.toContain('workspace-refresh:defer')
  })

  it('refreshes only the persistent workspace list after navigating to Today', async () => {
    routePath = '/settings'
    routeFullPath = '/settings'
    const { activateWorkspace } = useWorkspaces()

    await activateWorkspace('workspace-next')

    expect(reloadCalls).toEqual([
      'post:/api/workspaces/workspace-next/activate',
      'clear',
      'navigate',
      'next-tick',
      'workspace-refresh:defer',
    ])
    expect(reloadCalls).not.toContain('global-refresh')
  })
})
