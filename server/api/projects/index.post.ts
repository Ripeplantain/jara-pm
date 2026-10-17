import { createProjectSchema } from '#shared/schemas/project'
import { createProject } from '~~/server/services/projects'
import { requireUser } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, createProjectSchema.parse)
  const project = createProject(useDatabase(event), user.id, body)
  setResponseStatus(event, 201)
  return project
})
