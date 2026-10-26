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
  const { plan, proposal } = await readValidatedBody(event, body => acceptProposalSchema.parse(body ?? {}))
  const result = acceptProposal(useDatabase(event), user.id, workspaceId, id, { plan, proposal })
  const effective = proposal ?? plan
  const kind = result.kind
  captureServerEvent(event, user.id, kind === 'triage'
    ? 'ask_kobi_triage_accepted'
    : kind === 'reschedule'
      ? 'ask_kobi_reschedule_accepted'
      : kind === 'breakdown'
        ? 'ask_kobi_breakdown_accepted'
        : 'ask_kobi_plan_accepted', {
    edited: Boolean(effective),
    ...(plan && {
      projects: plan.projects.length,
      milestones: plan.projects.reduce((sum, project) => sum + project.milestones.length, 0),
      tasks: plan.projects.reduce((sum, project) => sum + project.milestones.reduce((count, milestone) => count + milestone.tasks.length, 0), 0),
    }),
    ...(proposal?.kind === 'triage' && { label_count: proposal.labelIds.length }),
    ...(result.kind === 'breakdown' && { milestones: result.milestoneIds.length }),
    ...(proposal?.kind === 'breakdown' && {
      tasks: proposal.milestones.reduce((count, milestone) => count + milestone.tasks.length, 0),
    }),
    ...(proposal?.kind === 'reschedule' && { change_count: proposal.changes.length }),
  })
  return result
})
