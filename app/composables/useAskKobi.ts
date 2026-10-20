export const useAskKobi = () => {
  const isOpen = useState<boolean>('ask-kobi-open', () => false)
  const draft = useState<string>('ask-kobi-draft', () => '')
  const open = (message = '') => {
    draft.value = message
    isOpen.value = true
  }
  const close = () => { isOpen.value = false }
  const reset = () => {
    draft.value = ''
    isOpen.value = false
  }
  return { isOpen, draft, open, close, reset }
}
