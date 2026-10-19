// USD per 1M tokens, as listed by OpenRouter on 2026-10-19. Prices change, so
// an unknown model reports cost as null rather than guessing, and either side
// can be overridden at run time with KOBI_EVAL_PRICE_INPUT / _OUTPUT.
export const MODEL_PRICING: Record<string, { input: number, output: number }> = {
  'openai/gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'openai/gpt-4.1': { input: 2.00, output: 8.00 },
  'deepseek/deepseek-v3.2': { input: 0.28, output: 0.42 },
  // OpenRouter's listed price. Routing can land on cheaper endpoints, so an
  // estimate from this entry is an upper bound.
  'deepseek/deepseek-v4.1-flash': { input: 0.30, output: 1.20 },
}

const envNumber = (name: string) => {
  const raw = process.env[name]
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

export const pricingFor = (model: string) => {
  const listed = MODEL_PRICING[model]
  const input = envNumber('KOBI_EVAL_PRICE_INPUT') ?? listed?.input
  const output = envNumber('KOBI_EVAL_PRICE_OUTPUT') ?? listed?.output
  if (input === undefined || output === undefined) return null
  return { input, output }
}

export const estimateCost = (model: string, promptTokens: number, completionTokens: number) => {
  const pricing = pricingFor(model)
  if (!pricing) return null
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000
}
