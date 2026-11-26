export type UiLanguage = 'en' | 'pt-BR'
export interface UiLanguageOption { id: UiLanguage; label: string; nativeLabel: string; shortLabel: string }
export const uiLanguages: readonly UiLanguage[]
export const defaultUiLanguage: UiLanguage
export const uiLanguageOptions: readonly UiLanguageOption[]
export function isUiLanguage(value: unknown): value is UiLanguage
export function resolveUiLanguage(value: unknown): UiLanguage
