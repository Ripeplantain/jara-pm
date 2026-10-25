import {
  CalendarDays,
  Check,
  CirclePlus,
  Flag,
  Inbox,
  LayoutGrid,
  Moon,
  Settings,
  Sparkles,
  Tag,
  Target,
  UserRound,
} from '@lucide/vue'
import type { Goal, Label, LabelCollection, Project, Task, TaskPriority, WorkspaceMember } from '#shared/types/domain'
import { estimateLabel, estimateOptions } from '#shared/utils/estimates'
import { parseTaskKey } from '#shared/utils/task-key'
import type { CommandAction } from '~/composables/useCommandPalette'

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

/**
 * Offsets are applied in UTC to match `todayIso()` in `server/utils/time.ts`, which is what the
 * Today view filters on. Using local midnight here would write yesterday's date for "today"
 * anywhere east of UTC, so the task would not appear in the view that just set it.
 */
const isoDay = (offsetDays: number) => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

/**
 * The palette's standard action set.
 *
 * Called from `CommandPalette.vue`, which is mounted only while the palette is open, so the four
 * lists below are fetched on first open rather than on every page load. They reuse the same
 * `useFetch` keys as the pages that show them, so opening the palette on the Projects page costs
 * no request at all.
 */
export const useGlobalCommands = () => {
  const router = useRouter()
  const { registerActions, query, close } = useCommandPalette()
  const { focused } = useFocusedTask()
  const { openTask } = useTaskPanel()
  const { patch, adopt, decorate } = useOptimisticTask()
  const { toggle: toggleTheme } = useTheme()
  const { open: openAskKobi } = useAskKobi()
  const { activeWorkspace, data: workspaces, activateWorkspace } = useWorkspaces()
  const { statuses } = useStatuses()
  const { refreshTaskViews } = useTaskViews()
  const { show } = useToasts()
  const { capture, captureException } = useProductAnalytics()

  const { data: projects } = useFetch<Project[]>('/api/projects', {
    key: 'projects-list',
    default: () => [],
    lazy: true,
  })
  const { data: goals } = useFetch<Goal[]>('/api/goals', {
    key: 'goals-list',
    default: () => [],
    lazy: true,
  })
  const { data: members } = useFetch<WorkspaceMember[]>('/api/workspace/members', {
    key: 'workspace-members-task-list',
    default: () => [],
    lazy: true,
  })
  const { data: labelCollection } = useFetch<LabelCollection>('/api/labels', {
    key: 'label-collection',
    default: (): LabelCollection => ({ groups: [], labels: [] }),
    lazy: true,
  })

  const go = (to: string) => async () => {
    close()
    await router.push(to)
  }

  const navigation = computed<CommandAction[]>(() => [
    { id: 'nav-today', label: 'Today', group: 'Navigation', icon: CalendarDays, keywords: ['home', 'dashboard'], run: go('/') },
    { id: 'nav-inbox', label: 'Inbox', group: 'Navigation', icon: Inbox, keywords: ['capture'], run: go('/inbox') },
    { id: 'nav-goals', label: 'Goals', group: 'Navigation', icon: Target, run: go('/goals') },
    { id: 'nav-projects', label: 'Projects', group: 'Navigation', icon: CirclePlus, run: go('/projects') },
    { id: 'nav-board', label: 'Board', group: 'Navigation', icon: LayoutGrid, keywords: ['kanban', 'status'], run: go('/board') },
    { id: 'nav-upcoming', label: 'Upcoming', group: 'Navigation', icon: CalendarDays, keywords: ['schedule', 'later'], run: go('/upcoming') },
    { id: 'nav-settings', label: 'Settings', group: 'Navigation', icon: Settings, keywords: ['preferences', 'labels', 'team'], run: go('/settings') },
  ])

  /**
   * The typed text becomes the title, which is why there is no second prompt: a palette that
   * asks a follow-up question is a dialog with extra steps. With nothing typed the action takes
   * the person to the Inbox, where the capture field already lives.
   */
  const creation = computed<CommandAction[]>(() => {
    const title = query.value.trim()
    if (!title) {
      return [
        { id: 'create-task', label: 'Create task…', group: 'Create', icon: CirclePlus, keywords: ['new', 'add'], run: go('/inbox') },
        { id: 'create-project', label: 'Create project…', group: 'Create', icon: CirclePlus, keywords: ['new'], run: go('/projects') },
        { id: 'create-goal', label: 'Create goal…', group: 'Create', icon: Target, keywords: ['new'], run: go('/goals') },
      ]
    }
    return [
      {
        id: 'create-task',
        label: `Create task “${title}”`,
        group: 'Create',
        icon: CirclePlus,
        keywords: ['new', 'add', 'task'],
        run: async () => {
          close()
          try {
            // No project, so it lands in the Inbox -- the same place QuickCapture puts it.
            await $fetch<Task>('/api/tasks', { method: 'POST', body: { title } })
            capture('task_created_from_palette')
            await refreshTaskViews()
          } catch (error: unknown) {
            captureException(error, { flow: 'palette_create_task' })
            show('Kobi could not create that task.')
          }
        },
      },
      {
        id: 'create-project',
        label: `Create project “${title}”`,
        group: 'Create',
        icon: CirclePlus,
        keywords: ['new', 'project'],
        run: async () => {
          close()
          try {
            const project = await $fetch<Project>('/api/projects', { method: 'POST', body: { title } })
            capture('project_created_from_palette')
            await router.push(`/projects/${project.id}`)
          } catch (error: unknown) {
            captureException(error, { flow: 'palette_create_project' })
            show('Kobi could not create that project.')
          }
        },
      },
      {
        id: 'create-goal',
        label: `Create goal “${title}”`,
        group: 'Create',
        icon: Target,
        keywords: ['new', 'goal'],
        run: async () => {
          close()
          try {
            const goal = await $fetch<Goal>('/api/goals', { method: 'POST', body: { title } })
            capture('goal_created_from_palette')
            await router.push(`/goals/${goal.id}`)
          } catch (error: unknown) {
            captureException(error, { flow: 'palette_create_goal' })
            show('Kobi could not create that goal.')
          }
        },
      },
    ]
  })

  const jumps = computed<CommandAction[]>(() => [
    ...projects.value.map(project => ({
      id: `jump-project-${project.id}`,
      label: project.title,
      group: 'Projects',
      icon: CirclePlus,
      keywords: [project.goalTitle ?? '', 'project'].filter(Boolean),
      run: go(`/projects/${project.id}`),
    })),
    ...goals.value.map(goal => ({
      id: `jump-goal-${goal.id}`,
      label: goal.title,
      group: 'Goals',
      icon: Target,
      keywords: ['goal'],
      run: go(`/goals/${goal.id}`),
    })),
  ])

  /** A typed task key is an action in its own right, so `ACME-7` + Enter opens that task. */
  const keyJump = computed<CommandAction[]>(() => {
    const typed = query.value.trim().toUpperCase()
    if (!parseTaskKey(typed)) return []
    return [{
      id: 'jump-task-key',
      label: `Open ${typed}`,
      group: 'Tasks',
      icon: Check,
      keywords: [typed],
      run: async () => {
        close()
        await openTask(typed)
      },
    }]
  })

  const workspaceActions = computed<CommandAction[]>(() =>
    workspaces.value
      .filter(workspace => !workspace.isActive)
      .map(workspace => ({
        id: `workspace-${workspace.id}`,
        label: `Switch to ${workspace.name}`,
        group: 'Workspace',
        icon: LayoutGrid,
        keywords: ['workspace', 'switch', 'change'],
        run: async () => {
          close()
          try {
            await activateWorkspace(workspace.id)
          } catch {
            // `useWorkspaces` already surfaces the failure through its own error state.
          }
        },
      })),
  )

  const preferences = computed<CommandAction[]>(() => [
    {
      id: 'toggle-theme',
      label: 'Toggle theme',
      group: 'Preferences',
      icon: Moon,
      keywords: ['dark', 'light', 'appearance'],
      run: () => {
        close()
        toggleTheme()
      },
    },
    {
      id: 'open-ask-kobi',
      label: 'Ask Kobi',
      group: 'Kobi',
      icon: Sparkles,
      keywords: ['ai', 'plan', 'assistant'],
      run: () => {
        close()
        openAskKobi()
      },
    },
  ])

  /**
   * Actions on the focused task. Every one is hidden by `when` rather than filtered out of the
   * list, so the palette shows the same commands the row's single-key shortcuts do and nothing
   * dangles when no task is focused.
   */
  const taskActions = computed<CommandAction[]>(() => {
    // Through the overlay, so an action run a moment ago is already reflected: without this the
    // palette would still offer "Add label: Urgent" for a label it just attached.
    const task = focused.value ? decorate(focused.value) : null
    if (!task) return []

    const hasTask = () => focused.value !== null
    const estimateScale = activeWorkspace.value?.estimateScale ?? 'none'

    const applyPatch = (label: string, changes: Parameters<typeof patch>[1]) => async () => {
      close()
      await patch(task, changes, { flow: 'palette_task_patch', message: `Kobi could not ${label}.` })
    }

    // Built from the workspace's own workflow, so a renamed or added status shows up here with
    // no code change.
    const statusActions = statuses.value
      .filter(status => status.id !== task.status.id)
      .map(status => ({
        id: `task-status-${status.id}`,
        label: `Set status: ${status.name}`,
        group: 'Task',
        icon: Check,
        keywords: ['status', task.key, status.name, status.category],
        when: hasTask,
        run: applyPatch('change that status', { status }),
      }))

    const priorityActions = (Object.keys(PRIORITY_LABELS) as TaskPriority[])
      .filter(priority => priority !== task.priority)
      .map(priority => ({
        id: `task-priority-${priority}`,
        label: `Set priority: ${PRIORITY_LABELS[priority]}`,
        group: 'Task',
        icon: Flag,
        keywords: ['priority', task.key, PRIORITY_LABELS[priority]],
        when: hasTask,
        run: applyPatch('change that priority', { priority }),
      }))

    const dueActions: CommandAction[] = [
      {
        id: 'task-due-today',
        label: 'Set due date: today',
        group: 'Task',
        icon: CalendarDays,
        keywords: ['due', 'date', task.key],
        when: hasTask,
        run: applyPatch('set that due date', { dueDate: isoDay(0) }),
      },
      {
        id: 'task-due-tomorrow',
        label: 'Set due date: tomorrow',
        group: 'Task',
        icon: CalendarDays,
        keywords: ['due', 'date', task.key],
        when: hasTask,
        run: applyPatch('set that due date', { dueDate: isoDay(1) }),
      },
      {
        id: 'task-due-next-week',
        label: 'Set due date: next week',
        group: 'Task',
        icon: CalendarDays,
        keywords: ['due', 'date', task.key],
        when: hasTask,
        run: applyPatch('set that due date', { dueDate: isoDay(7) }),
      },
    ]

    if (task.dueDate) {
      dueActions.push({
        id: 'task-due-clear',
        label: 'Clear due date',
        group: 'Task',
        icon: CalendarDays,
        keywords: ['due', 'date', 'remove', task.key],
        when: hasTask,
        run: applyPatch('clear that due date', { dueDate: null }),
      })
    }

    const assigneeActions: CommandAction[] = members.value
      .filter(member => member.userId !== task.assigneeId)
      .map(member => ({
        id: `task-assign-${member.userId}`,
        label: `Assign to ${member.name}`,
        group: 'Task',
        icon: UserRound,
        keywords: ['assign', 'owner', member.email, task.key],
        when: hasTask,
        run: applyPatch('assign that task', { assigneeId: member.userId }),
      }))

    if (task.assigneeId) {
      assigneeActions.push({
        id: 'task-unassign',
        label: 'Unassign',
        group: 'Task',
        icon: UserRound,
        keywords: ['assign', 'remove', task.key],
        when: hasTask,
        run: applyPatch('unassign that task', { assigneeId: null }),
      })
    }

    // Estimates are offered only when the workspace has a scale, exactly as the row's control is.
    const estimateActions: CommandAction[] = estimateScale === 'none'
      ? []
      : estimateOptions(estimateScale).map(option => ({
        id: `task-estimate-${option.value}`,
        label: `Set estimate: ${option.label}`,
        group: 'Task',
        icon: Flag,
        keywords: ['estimate', 'points', 'size', task.key],
        when: hasTask,
        run: applyPatch('set that estimate', { estimate: option.value }),
      }))

    if (estimateScale !== 'none' && task.estimate !== null) {
      estimateActions.push({
        id: 'task-estimate-clear',
        label: `Clear estimate (${estimateLabel(estimateScale, task.estimate)})`,
        group: 'Task',
        icon: Flag,
        keywords: ['estimate', 'remove', task.key],
        when: hasTask,
        run: applyPatch('clear that estimate', { estimate: null }),
      })
    }

    const attachedIds = new Set(task.labels.map(label => label.id))
    const labelActions: CommandAction[] = labelCollection.value.labels.map((label: Label) => ({
      id: `task-label-${label.id}`,
      label: attachedIds.has(label.id) ? `Remove label: ${label.name}` : `Add label: ${label.name}`,
      group: 'Task',
      icon: Tag,
      keywords: ['label', 'tag', label.name, task.key],
      when: hasTask,
      run: async () => {
        close()
        try {
          // The label endpoints return the whole task, which is the only thing that knows which
          // grouped sibling was replaced, so the result is adopted rather than guessed at.
          const updated = attachedIds.has(label.id)
            ? await $fetch<Task>(`/api/tasks/${task.id}/labels/${label.id}`, { method: 'DELETE' })
            : await $fetch<Task>(`/api/tasks/${task.id}/labels`, { method: 'POST', body: { labelId: label.id } })
          adopt(updated)
        } catch (error: unknown) {
          captureException(error, { flow: 'palette_task_label' })
          show('Kobi could not change that label.')
        }
      },
    }))

    return [
      {
        id: 'task-open',
        label: `Open ${task.key}`,
        group: 'Task',
        icon: Check,
        keywords: ['detail', 'panel', task.title],
        when: hasTask,
        run: async () => {
          close()
          await openTask(task.key)
        },
      },
      ...statusActions,
      ...priorityActions,
      ...dueActions,
      ...assigneeActions,
      ...estimateActions,
      ...labelActions,
    ]
  })

  const actions = computed<CommandAction[]>(() => [
    ...keyJump.value,
    ...navigation.value,
    ...creation.value,
    ...jumps.value,
    ...taskActions.value,
    ...workspaceActions.value,
    ...preferences.value,
  ])

  registerActions('global', actions)

  return { actions }
}
