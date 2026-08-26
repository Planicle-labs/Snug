import type { Context } from 'hono'
import type { AppEnv } from '../index'

export interface WidgetConfigResponse {
  position: string
  button_text: string
  button_color: string
  button_text_color: string
  modal_position: string
  show_confidence: boolean
  show_reasoning: boolean
}

export const DEFAULT_WIDGET_CONFIG: WidgetConfigResponse = {
  position: 'below_add_to_cart',
  button_text: 'Find Your Recommended Size',
  button_color: '#008060',
  button_text_color: '#ffffff',
  modal_position: 'center',
  show_confidence: true,
  show_reasoning: true,
}

export async function handleWidgetConfigLookup(ctx: Context<AppEnv>) {
  const org = ctx.var.org
  const configRaw = await ctx.env.KV.get<WidgetConfigResponse>(
    `widget_config:${org.org_id}`,
    'json'
  )

  if (configRaw && typeof configRaw === 'object' && !Array.isArray(configRaw)) {
    const raw = configRaw as unknown as Record<string, unknown>
    return ctx.json({
      position: (typeof raw.position === 'string' && raw.position) || DEFAULT_WIDGET_CONFIG.position,
      button_text: (typeof raw.button_text === 'string' && raw.button_text) || (typeof raw.buttonText === 'string' && raw.buttonText) || DEFAULT_WIDGET_CONFIG.button_text,
      button_color: (typeof raw.button_color === 'string' && raw.button_color) || (typeof raw.primaryColor === 'string' && raw.primaryColor) || (typeof raw.buttonColor === 'string' && raw.buttonColor) || DEFAULT_WIDGET_CONFIG.button_color,
      button_text_color: (typeof raw.button_text_color === 'string' && raw.button_text_color) || (typeof raw.buttonTextColor === 'string' && raw.buttonTextColor) || DEFAULT_WIDGET_CONFIG.button_text_color,
      modal_position: (typeof raw.modal_position === 'string' && raw.modal_position) || (typeof raw.modalPosition === 'string' && raw.modalPosition) || DEFAULT_WIDGET_CONFIG.modal_position,
      show_confidence: typeof raw.show_confidence === 'boolean' ? raw.show_confidence : (typeof raw.showConfidence === 'boolean' ? raw.showConfidence : DEFAULT_WIDGET_CONFIG.show_confidence),
      show_reasoning: typeof raw.show_reasoning === 'boolean' ? raw.show_reasoning : (typeof raw.showReasoning === 'boolean' ? raw.showReasoning : DEFAULT_WIDGET_CONFIG.show_reasoning),
    }, 200)
  }

  return ctx.json(DEFAULT_WIDGET_CONFIG, 200)
}

