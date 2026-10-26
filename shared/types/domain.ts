/**
 * The fixed set of status categories. A workspace names and orders its own statuses, but every
 * status belongs to one of these, and automation reasons about the category rather than the name
 * -- which is what lets a team rename "Done" without changing what completion means.
 *
 * Not user-definable, deliberately: `completed` and `canceled` carry behaviour (progress
 * exclusion, cycle rollover) that cannot be inferred from a name.
 */
export const STATUS_CATEGORIES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'] as const
export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high'] as const
export const TASK_RECURRENCES = ['none', 'daily', 'weekly'] as const
export const GOAL_STATUSES = ['active', 'completed', 'archived'] as const
export const PROJECT_STATUSES = ['active', 'paused', 'completed', 'archived'] as const
export const ESTIMATE_SCALES = ['none', 'exponential', 'fibonacci', 'linear', 'tshirt'] as const
export const LABEL_COLORS = [
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const

export type StatusCategory = (typeof STATUS_CATEGORIES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number]
export type GoalStatus = (typeof GOAL_STATUSES)[number]
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export type EstimateScale = (typeof ESTIMATE_SCALES)[number]
export type LabelColor = (typeof LABEL_COLORS)[number]
export type WorkspaceRole = 'owner' | 'member'

/** A workspace's named workflow step. */
export type Status = {
  id: string
  name: string
  category: StatusCategory
  position: number
  isDefault: boolean
}

export type WorkspaceSummary = {
  id: string
  name: string
  key: string
  estimateScale: EstimateScale
  role: WorkspaceRole
}

export type WorkspaceListItem = WorkspaceSummary & {
  isActive: boolean
}

export type WorkspaceMember = {
  userId: string
  name: string
  email: string
  role: WorkspaceRole
  joinedAt: string
}

export type User = {
  id: string
  email: string
  name: string
  workspace?: WorkspaceSummary
}

export type LabelGroup = {
  id: string
  name: string
  position: number
}

export type Label = {
  id: string
  groupId: string | null
  groupName: string | null
  name: string
  color: LabelColor
  description: string
  archivedAt: string | null
}

// Groups travel with the labels so a picker can render single-select groups without a
// second request. Archived labels are omitted unless the caller opts in.
export type LabelCollection = {
  groups: LabelGroup[]
  labels: Label[]
}

export type Task = {
  id: string
  number: number
  key: string
  title: string
  description: string
  status: Status
  priority: TaskPriority
  dueDate: string | null
  scheduledFor: string | null
  recurrence: TaskRecurrence
  selectedForToday: boolean
  assigneeId: string | null
  assigneeName: string | null
  assigneeEmail: string | null
  projectId: string | null
  projectTitle: string | null
  milestoneId: string | null
  milestoneTitle: string | null
  parentId: string | null
  estimate: number | null
  labels: Label[]
  // First transition into a `started` category; set once, never cleared.
  startedAt: string | null
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
  points: number
  completedPoints: number
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
  points: number
  completedPoints: number
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
  points: number
  completedPoints: number
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
  completedToday: Task[]
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

export type TriageProposal = {
  kind: 'triage'
  taskId: string
  labelIds: string[]
  priority: TaskPriority
  projectId: string | null
  estimate: number | null
  reason: string
}

export type RescheduleProposal = {
  kind: 'reschedule'
  note: string
  changes: Array<{
    taskId: string
    dueDate: string | null
    scheduledFor: string | null
    selectedForToday: boolean
    statusCategory: 'backlog' | 'canceled' | null
    reason: string
  }>
}

// New milestones (with tasks) for an existing project; the shape is goal_plan's own.
export type BreakdownProposal = {
  kind: 'breakdown'
  projectId: string
  milestones: GoalPlanProposal['projects'][number]['milestones']
}

export type Proposal = GoalPlanProposal | TriageProposal | RescheduleProposal | BreakdownProposal

// 'offline' marks a reply produced by the local fallback because no provider key
// is configured or the provider call failed. It must stay visible to the client:
// a fallback that looks like a model reply hides provider outages completely.
// 'invalid' marks a model reply that arrived but broke the reply contract, so
// nothing was drafted; it is not an outage and carries no proposal.
export type AiReplySource = 'model' | 'offline' | 'invalid'

export type AiKindReply<P extends Proposal> = {
  message: string
  proposalId: string | null
  proposal: P | null
  source: AiReplySource
}

export type AiReply = AiKindReply<GoalPlanProposal>
export type TriageReply = AiKindReply<TriageProposal>
export type RescheduleReply = AiKindReply<RescheduleProposal>
export type BreakdownReply = AiKindReply<BreakdownProposal>
