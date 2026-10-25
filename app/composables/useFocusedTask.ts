import type { Task } from '#shared/types/domain'

/**
 * The task the person is currently on, set by a row on hover or keyboard focus and by the task
 * panel when it opens.
 *
 * The command palette needs this: "set priority" is only an offer worth making when there is a
 * task to set it on, and Linear's palette is contextual in exactly this way. Keeping it in one
 * piece of state rather than passing a prop down means any surface can contribute a focus
 * without the palette knowing that surface exists.
 */
export const useFocusedTask = () => {
  const focused = useState<Task | null>('kobi-focused-task', () => null)

  const focus = (task: Task) => {
    // Skipping an identical re-focus avoids a write (and so a re-render of every subscriber) on
    // each mousemove that re-enters the same row. `updatedAt` is part of the comparison because
    // the id alone would freeze the snapshot: the palette builds its task actions from these
    // field values, and a stale snapshot offers to add a label the task already carries.
    const current = focused.value
    if (current?.id === task.id && current.updatedAt === task.updatedAt) return
    focused.value = task
  }

  const blur = (taskId?: string) => {
    if (!taskId || focused.value?.id === taskId) focused.value = null
  }

  const isFocused = (taskId: string) => focused.value?.id === taskId

  return { focused, focus, blur, isFocused }
}
