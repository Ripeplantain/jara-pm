export const useTheme = () => {
  const theme = useState<'light' | 'dark'>('app-theme', () => 'light')

  const apply = (value: 'light' | 'dark') => {
    theme.value = value
    if (import.meta.client) {
      document.documentElement.dataset.theme = value
      document.documentElement.classList.toggle('dark', value === 'dark')
      localStorage.setItem('kobi-theme', value)
    }
  }

  const initialize = () => {
    if (!import.meta.client) return
    const saved = localStorage.getItem('kobi-theme')
    const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    apply(saved === 'dark' || saved === 'light' ? saved : preferred)
  }

  const toggle = () => apply(theme.value === 'dark' ? 'light' : 'dark')
  return { theme, initialize, toggle }
}
