import type { ConfirmationOptions, ConfirmationOutcome, ConfirmationRequest } from '~/types/confirmation'

export const useConfirmation = () => {
  const request = useState<ConfirmationRequest | null>('kobi-confirmation-request', () => null)
  const outcome = useState<ConfirmationOutcome | null>('kobi-confirmation-outcome', () => null)

  const respond = (accepted: boolean) => {
    const current = request.value
    if (!current) return
    request.value = null
    outcome.value = { id: current.id, accepted }
  }

  const confirm = async (options: ConfirmationOptions): Promise<boolean> => {
    if (!import.meta.client) return false

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (request.value) respond(false)

    const id = crypto.randomUUID()
    request.value = {
      ...options,
      id,
      cancelLabel: options.cancelLabel ?? 'Cancel',
    }

    const accepted = await new Promise<boolean>((resolve) => {
      let stop = () => {}
      stop = watch(outcome, (result) => {
        if (result?.id !== id) return
        stop()
        resolve(result.accepted)
      }, { flush: 'sync' })
    })

    await nextTick()
    if (previouslyFocused?.isConnected) previouslyFocused.focus()
    return accepted
  }

  return {
    request: readonly(request),
    confirm,
    accept: () => respond(true),
    cancel: () => respond(false),
  }
}
