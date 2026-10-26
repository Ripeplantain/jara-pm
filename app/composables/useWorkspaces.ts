import type { WorkspaceListItem } from '#shared/types/domain'
import { getUserFacingErrorMessage } from '#shared/utils/error-message'

const WORKSPACE_SYNC_KEY = 'kobi-workspace-changed'
const emptyWorkspaceList = (): WorkspaceListItem[] => []
let workspaceSyncRegistered = false

export const notifyWorkspaceChanged = (workspaceId: string) => {
  try {
    localStorage.setItem(WORKSPACE_SYNC_KEY, `${workspaceId}:${Date.now()}`)
  } catch {
    // Cross-tab refresh is best effort; the server-side workspace change already succeeded.
  }
}

export const useWorkspaces = () => {
  const route = useRoute()
  const request = useFetch<WorkspaceListItem[]>('/api/workspaces', {
    key: 'workspace-list',
    default: emptyWorkspaceList,
    dedupe: 'defer',
  })
  const isChanging = useState<boolean>('workspace-changing', () => false)
  const actionError = useState<string>('workspace-action-error', () => '')
  const activeWorkspace = computed(() => request.data.value.find(workspace => workspace.isActive) ?? null)
  const { reset: resetAskKobi } = useAskKobi()
  const { resetOverlay } = useOptimisticTask()

  const reloadWorkspaceContext = async () => {
    const startedOnHome = route.path === '/'
    const needsNavigation = route.fullPath !== '/'
    resetAskKobi()
    // Pending optimistic changes belong to the workspace being left. `clearNuxtData` does not
    // touch `useState`, so without this they would be merged onto the new workspace's lists.
    resetOverlay()
    await clearNuxtData()
    if (needsNavigation) {
      await navigateTo('/', { replace: true })
      // Let scopes from the previous route finish unmounting before starting replacement fetches.
      await nextTick()
    }
    // On Today those scopes stay mounted, so refresh them all. After a cross-route navigation the
    // new page has already started its own fetches; only the persistent workspace list needs an
    // explicit refresh, and it should join any request already in flight.
    if (startedOnHome) await refreshNuxtData()
    else await request.refresh({ dedupe: 'defer' })
  }

  onMounted(() => {
    if (workspaceSyncRegistered) return
    workspaceSyncRegistered = true
    window.addEventListener('storage', (event) => {
      if (event.key === WORKSPACE_SYNC_KEY && event.newValue) void reloadWorkspaceContext()
    })
  })

  const activateWorkspace = async (workspaceId: string) => {
    if (activeWorkspace.value?.id === workspaceId || isChanging.value) return
    isChanging.value = true
    actionError.value = ''
    try {
      await $fetch(`/api/workspaces/${workspaceId}/activate`, { method: 'POST' })
      notifyWorkspaceChanged(workspaceId)
      await reloadWorkspaceContext()
    } catch (error: unknown) {
      actionError.value = getUserFacingErrorMessage(error, 'Could not switch workspaces.')
      throw error
    } finally {
      isChanging.value = false
    }
  }

  const createWorkspace = async (name: string) => {
    if (isChanging.value) return
    isChanging.value = true
    actionError.value = ''
    try {
      const workspace = await $fetch<WorkspaceListItem>('/api/workspaces', { method: 'POST', body: { name } })
      notifyWorkspaceChanged(workspace.id)
      await reloadWorkspaceContext()
    } catch (error: unknown) {
      actionError.value = getUserFacingErrorMessage(error, 'Could not create the workspace.')
      throw error
    } finally {
      isChanging.value = false
    }
  }

  return {
    ...request,
    activeWorkspace,
    isChanging,
    actionError,
    activateWorkspace,
    createWorkspace,
  }
}
