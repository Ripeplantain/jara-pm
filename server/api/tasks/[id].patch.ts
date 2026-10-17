import { idParamsSchema } from '#shared/schemas/query'
import { updateTaskSchema } from '#shared/schemas/task'
import { updateTask } from '~~/server/services/tasks'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  const body = await readValidatedBody(event, updateTaskSchema.parse)
  const task = updateTask(useDatabase(event), user.id, id, body)
  if (body.status === 'done') captureServerEvent(event, user.id, 'task_completed')
  else if (body.status === 'todo') captureServerEvent(event, user.id, 'task_reopened')
  if (body.dueDate !== undefined) captureServerEvent(event, user.id, 'task_rescheduled', { has_due_date: Boolean(task.dueDate) })
  return task
})
