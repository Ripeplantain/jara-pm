import tailwindcss from '@tailwindcss/vite'

const posthogProjectToken = process.env.NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN || process.env.POSTHOG_PROJECT_TOKEN || ''
const posthogHost = process.env.NUXT_PUBLIC_POSTHOG_HOST || process.env.POSTHOG_HOST || 'https://us.i.posthog.com'
const posthogSessionReplay = process.env.NUXT_PUBLIC_POSTHOG_SESSION_REPLAY === 'true'
const legacyLlmModel = process.env.NUXT_LLM_MODEL || 'openai/gpt-4.1-mini'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  modules: ['nuxt-auth-utils', '@posthog/nuxt'],
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
      model: legacyLlmModel,
      chatModel: process.env.NUXT_LLM_CHAT_MODEL || '',
      planModel: process.env.NUXT_LLM_PLAN_MODEL || 'openai/gpt-4.1',
    },
    public: {
      appName: 'Kobi',
      posthog: {
        publicKey: posthogProjectToken,
        host: posthogHost,
      },
    },
  },
  posthogConfig: {
    publicKey: posthogProjectToken,
    host: posthogHost,
    clientConfig: {
      capture_exceptions: true,
      disable_session_recording: !posthogSessionReplay,
    },
    serverConfig: {
      enableExceptionAutocapture: true,
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
