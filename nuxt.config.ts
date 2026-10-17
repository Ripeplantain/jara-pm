import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  modules: ['nuxt-auth-utils'],
  components: [{ path: '~/components', pathPrefix: false }],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  runtimeConfig: {
    databasePath: './data/kobi.db',
    llm: {
      apiKey: '',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4.1-mini',
    },
    public: {
      appName: 'Kobi',
    },
  },
  routeRules: {
    '/welcome': { prerender: true },
    '/privacy': { prerender: true },
    '/terms': { prerender: true },
  },
  typescript: {
    strict: true,
    typeCheck: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
  nitro: {
    compressPublicAssets: true,
  },
})
