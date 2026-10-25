import { updateWorkspaceSchema } from '#shared/schemas/workspace'
import { getWorkspace, updateWorkspace } from '~~/server/services/workspace'
import { requireOwner } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireOwner(event)
  const body = await readValidatedBody(event, updateWorkspaceSchema.parse)
  const db = useDatabase(event)
  // The settings form always sends both fields, so the previous values decide what actually
  // changed. Without this, every save reported a key change and a scale change.
  const previous = getWorkspace(db, user.id, workspaceId)
  const workspace = updateWorkspace(db, user.id, workspaceId, body)
  if (workspace.estimateScale !== previous.estimateScale) {
    captureServerEvent(event, user.id, 'workspace_estimate_scale_changed', { scale: workspace.estimateScale })
  }
  if (workspace.key !== previous.key) captureServerEvent(event, user.id, 'workspace_key_changed')
  return workspace
})
