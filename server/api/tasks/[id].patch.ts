import { idParamsSchema } from '#shared/schemas/query'
import { updateTaskSchema } from '#shared/schemas/task'
import { getTask, updateTask } from '~~/server/services/tasks'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, updateTaskSchema.parse)
  const db = useDatabase(event)
  const before = body.statusId === undefined ? null : getTask(db, user.id, workspaceId, id)
  const task = updateTask(db, user.id, workspaceId, id, body)
  // Categories, not names or ids: a renamed "Done" must still count as completion.
  if (before) {
    const wasCompleted = before.status.category === 'completed'
    const isCompleted = task.status.category === 'completed'
    if (isCompleted && !wasCompleted) captureServerEvent(event, user.id, 'task_completed')
    else if (wasCompleted && !isCompleted) captureServerEvent(event, user.id, 'task_reopened')
  }
  if (body.dueDate !== undefined) captureServerEvent(event, user.id, 'task_rescheduled', { has_due_date: Boolean(task.dueDate) })
  return task
})
