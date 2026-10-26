import type { WorkspaceMember } from '#shared/types/domain'

const emptyWorkspaceMembers = (): WorkspaceMember[] => []

/** Shared member list used by task assignment controls across the current workspace. */
export const useWorkspaceMembers = () => useFetch<WorkspaceMember[]>('/api/workspace/members', {
  key: 'workspace-members-task-list',
  default: emptyWorkspaceMembers,
  lazy: true,
  dedupe: 'defer',
})
