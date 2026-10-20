import { createTaskSchema } from '#shared/schemas/task'
import { createTask } from '~~/server/services/tasks'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const body = await readValidatedBody(event, createTaskSchema.parse)
  const task = createTask(useDatabase(event), user.id, workspaceId, body)
  captureServerEvent(event, user.id, 'task_created', {
    has_project: Boolean(body.projectId),
    has_due_date: Boolean(body.dueDate),
    priority: body.priority,
  })
  setResponseStatus(event, 201)
  return task
})
