export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const
export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high'] as const
export const GOAL_STATUSES = ['active', 'completed', 'archived'] as const
export const PROJECT_STATUSES = ['active', 'paused', 'completed', 'archived'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export type GoalStatus = (typeof GOAL_STATUSES)[number]
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export type User = {
  id: string
  email: string
  name: string
}

export type Task = {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  scheduledFor: string | null
  selectedForToday: boolean
  projectId: string | null
  projectTitle: string | null
  milestoneId: string | null
  milestoneTitle: string | null
  parentId: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type Milestone = {
  id: string
  projectId: string
  title: string
  description: string
  targetDate: string | null
  position: number
  status: 'active' | 'completed'
  taskCount: number
  completedTaskCount: number
  progress: number | null
}

export type Project = {
  id: string
  goalId: string | null
  goalTitle: string | null
  title: string
  description: string
  status: ProjectStatus
  targetDate: string | null
  taskCount: number
  completedTaskCount: number
  progress: number | null
  milestones: Milestone[]
  createdAt: string
  updatedAt: string
}

export type Goal = {
  id: string
  title: string
  description: string
  status: GoalStatus
  targetDate: string | null
  projectCount: number
  taskCount: number
  completedTaskCount: number
  progress: number | null
  createdAt: string
  updatedAt: string
}

export type TodayData = {
  date: string
  greeting: string
  priorities: Task[]
  overdue: Task[]
  upcoming: Task[]
  suggestion: string | null
}

export type GoalPlanProposal = {
  kind: 'goal_plan'
  goal: {
    title: string
    description: string
    targetDate: string | null
  }
  projects: Array<{
    title: string
    description: string
    milestones: Array<{
      title: string
      targetDate: string | null
      tasks: Array<{
        title: string
        dueDate: string | null
        priority: TaskPriority
      }>
    }>
  }>
}

// 'offline' marks a reply produced by the local fallback because no provider key
// is configured or the provider call failed. It must stay visible to the client:
// a fallback that looks like a model reply hides provider outages completely.
export type AiReplySource = 'model' | 'offline'

export type AiReply = {
  message: string
  proposalId: string | null
  proposal: GoalPlanProposal | null
  source: AiReplySource
}
