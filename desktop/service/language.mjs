// Shared by the desktop app, mobile web app and settings validation.
// English remains the default and fallback; pt-BR translates the UI chrome non-destructively.
export const uiLanguages = ['en', 'pt-BR'];
export const defaultUiLanguage = 'en';
export const uiLanguageOptions = [
  { id: 'en', label: 'English', nativeLabel: 'English', shortLabel: 'EN' },
  { id: 'pt-BR', label: 'Portuguese (Brazil)', nativeLabel: 'Português (Brasil)', shortLabel: 'PT-BR' },
];
export const isUiLanguage = value => value === 'en' || value === 'pt-BR';
export const resolveUiLanguage = value => isUiLanguage(value) ? value : defaultUiLanguage;
