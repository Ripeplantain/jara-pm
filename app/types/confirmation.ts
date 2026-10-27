export type ConfirmationOptions = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
}

export type ConfirmationRequest = ConfirmationOptions & {
  id: string
  cancelLabel: string
}

export type ConfirmationOutcome = {
  id: string
  accepted: boolean
}
