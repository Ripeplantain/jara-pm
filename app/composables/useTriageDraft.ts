import { triageProposalSchema } from '#shared/schemas/ai'
import type { TriageProposal } from '#shared/types/domain'

export type TriageDraft = Omit<TriageProposal, 'kind'>

export const toTriageDraft = (proposal: TriageProposal): TriageDraft => ({
  taskId: proposal.taskId,
  labelIds: [...proposal.labelIds],
  priority: proposal.priority,
  projectId: proposal.projectId,
  estimate: proposal.estimate,
  reason: proposal.reason,
})

export const toTriageProposal = (draft: TriageDraft): TriageProposal => ({ kind: 'triage', ...draft })

export const firstTriageIssue = (draft: TriageDraft): string => {
  const result = triageProposalSchema.safeParse(toTriageProposal(draft))
  if (result.success) return ''
  const field = result.error.issues[0]?.path.at(-1) ?? 'proposal'
  return `Fix the ${String(field)} before accepting this suggestion.`
}
