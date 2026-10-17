import { createTaskSchema } from '#shared/schemas/task'
import { createTask } from '~~/server/services/tasks'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, createTaskSchema.parse)
  const task = createTask(useDatabase(event), user.id, body)
  setResponseStatus(event, 201)
  return task
})
