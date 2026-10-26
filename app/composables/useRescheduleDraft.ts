import { rescheduleProposalSchema } from '#shared/schemas/ai'
import type { RescheduleProposal } from '#shared/types/domain'

export type RescheduleDraftChange = RescheduleProposal['changes'][number] & { id: string }
export type RescheduleDraft = { note: string, changes: RescheduleDraftChange[] }

export const toRescheduleDraft = (proposal: RescheduleProposal): RescheduleDraft => ({
  note: proposal.note,
  changes: proposal.changes.map(change => ({ ...change, id: crypto.randomUUID() })),
})

export const toRescheduleProposal = (draft: RescheduleDraft): RescheduleProposal => ({
  kind: 'reschedule',
  note: draft.note,
  changes: draft.changes.map(({ id: _id, ...change }) => change),
})

export const firstRescheduleIssue = (draft: RescheduleDraft): string => {
  const result = rescheduleProposalSchema.safeParse(toRescheduleProposal(draft))
  if (result.success) return ''
  if (draft.changes.length === 0) return 'Keep at least one task or reject this suggestion.'
  const field = result.error.issues[0]?.path.at(-1) ?? 'proposal'
  return `Fix the ${String(field)} before accepting this suggestion.`
}
