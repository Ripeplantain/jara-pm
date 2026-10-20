import { goalPlanProposalSchema } from '#shared/schemas/ai'
import type { GoalPlanProposal, TaskPriority } from '#shared/types/domain'

// Editable mirror of a GoalPlanProposal. Every project, milestone and task carries a
// client-only `id` so v-for keys survive title edits; toPlan() strips them again.
export type DraftTask = { id: string, title: string, dueDate: string | null, priority: TaskPriority }
export type DraftMilestone = { id: string, title: string, targetDate: string | null, tasks: DraftTask[] }
export type DraftProject = { id: string, title: string, description: string, milestones: DraftMilestone[] }
export type DraftPlan = {
  goal: GoalPlanProposal['goal']
  projects: DraftProject[]
}

export const toDraft = (plan: GoalPlanProposal): DraftPlan => ({
  goal: { ...plan.goal },
  projects: plan.projects.map(project => ({
    id: crypto.randomUUID(),
    title: project.title,
    description: project.description,
    milestones: project.milestones.map(milestone => ({
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
  })),
})

export const toPlan = (draft: DraftPlan): GoalPlanProposal => ({
  kind: 'goal_plan',
  goal: { title: draft.goal.title, description: draft.goal.description, targetDate: draft.goal.targetDate },
  projects: draft.projects.map(project => ({
    title: project.title,
    description: project.description,
    milestones: project.milestones.map(milestone => ({
      title: milestone.title,
      targetDate: milestone.targetDate,
      tasks: milestone.tasks.map(task => ({ title: task.title, dueDate: task.dueDate, priority: task.priority })),
    })),
  })),
})

const LABELS: Record<string, string> = {
  goal: 'goal', projects: 'project', milestones: 'milestone', tasks: 'task',
  title: 'title', description: 'description', targetDate: 'date', dueDate: 'date', priority: 'priority',
}

// A short, human message for the first problem in the plan, or '' when it is valid.
export const firstPlanIssue = (draft: DraftPlan): string => {
  const result = goalPlanProposalSchema.safeParse(toPlan(draft))
  if (result.success) return ''
  const path = result.error.issues[0]?.path ?? []
  const parts = path.filter((segment): segment is string => typeof segment === 'string' && segment in LABELS).map(segment => LABELS[segment])
  const field = parts.length ? parts.join(' ') : 'plan'
  return `Fix the ${field}: it is empty, too long, or not valid.`
}
