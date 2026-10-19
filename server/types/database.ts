export type UserRow = {
  id: string
  email: string
  name: string
  password_hash: string
  created_at: string
  updated_at: string
}

export type TaskRow = {
  id: string
  user_id: string
  project_id: string | null
  project_title: string | null
  milestone_id: string | null
  milestone_title: string | null
  parent_id: string | null
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done'
  priority: 'none' | 'low' | 'medium' | 'high'
  due_date: string | null
  scheduled_for: string | null
  recurrence: 'none' | 'daily' | 'weekly'
  selected_for_today: boolean
  completed_at: string | null
  position: number
  created_at: string
  updated_at: string
}

export type GoalRow = {
  id: string
  user_id: string
  title: string
  description: string
  status: 'active' | 'completed' | 'archived'
  target_date: string | null
  created_at: string
  updated_at: string
  project_count: number
  task_count: number
  completed_task_count: number
}

export type ProjectRow = {
  id: string
  user_id: string
  goal_id: string | null
  goal_title: string | null
  title: string
  description: string
  status: 'active' | 'paused' | 'completed' | 'archived'
  target_date: string | null
  created_at: string
  updated_at: string
  task_count: number
  completed_task_count: number
}

export type MilestoneRow = {
  id: string
  project_id: string
  user_id: string
  title: string
  description: string
  target_date: string | null
  position: number
  status: 'active' | 'completed'
  task_count: number
  completed_task_count: number
}
