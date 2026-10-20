import { acceptProposalSchema } from '#shared/schemas/ai'
import { idParamsSchema } from '#shared/schemas/query'
import { acceptProposal } from '~~/server/services/ai'
import { requireMember } from '~~/server/utils/auth'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event)
  const { id } = await getValidatedRouterParams(event, idParamsSchema.parse)
  // h3 hands the validator `undefined` for an empty body, so default it to {}.
  const { plan } = await readValidatedBody(event, body => acceptProposalSchema.parse(body ?? {}))
  const result = acceptProposal(useDatabase(event), user.id, workspaceId, id, { plan })
  captureServerEvent(event, user.id, 'ask_kobi_plan_accepted', {
    edited: Boolean(plan),
    ...(plan && {
      projects: plan.projects.length,
      milestones: plan.projects.reduce((sum, project) => sum + project.milestones.length, 0),
      tasks: plan.projects.reduce((sum, project) => sum + project.milestones.reduce((count, milestone) => count + milestone.tasks.length, 0), 0),
    }),
  })
  return result
})
