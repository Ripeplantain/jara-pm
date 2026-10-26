import { breakdownProposalSchema } from '#shared/schemas/ai'
import type { BreakdownProposal } from '#shared/types/domain'
import type { DraftMilestone } from '~/composables/useProposalDraft'

// Editable mirror of a BreakdownProposal. Milestones and tasks carry a client-only `id` so
// v-for keys survive title edits; toBreakdownProposal() strips them again.
export type BreakdownDraft = { projectId: string, milestones: DraftMilestone[] }

export const toBreakdownDraft = (proposal: BreakdownProposal): BreakdownDraft => ({
  projectId: proposal.projectId,
  milestones: proposal.milestones.map(milestone => ({
    id: crypto.randomUUID(),
    title: milestone.title,
    targetDate: milestone.targetDate,
    tasks: milestone.tasks.map(task => ({
      id: crypto.randomUUID(),
      title: task.title,
      dueDate: task.dueDate,
      priority: task.priority,
    })),
  })),
})

export const toBreakdownProposal = (draft: BreakdownDraft): BreakdownProposal => ({
  kind: 'breakdown',
  projectId: draft.projectId,
  milestones: draft.milestones.map(milestone => ({
    title: milestone.title,
    targetDate: milestone.targetDate,
    tasks: milestone.tasks.map(task => ({ title: task.title, dueDate: task.dueDate, priority: task.priority })),
  })),
})

export const firstBreakdownIssue = (draft: BreakdownDraft): string => {
  if (!draft.milestones.length) return 'Keep at least one milestone or reject this suggestion.'
  const result = breakdownProposalSchema.safeParse(toBreakdownProposal(draft))
  if (result.success) return ''
  return 'Fix the milestones: one is empty, too long, or not valid.'
}
