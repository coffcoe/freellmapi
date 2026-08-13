export {
  I18nProvider,
  type I18nProviderProps,
} from './I18nProvider'
export { useI18n, type I18nContextValue } from './context'
// SUPPORTED_LOCALES / Locale / DEFAULT_LOCALE must stay in sync with what
// I18nProvider actually loads (6 dictionaries). Exporting the 60-locale list
// from locale-config here made the settings language dropdown offer 54
// "ghost" languages whose setLocale() is silently rejected (e.g. zh-TW) —
// users clicking 中文(繁體) saw no reaction. locale-config.ts is now unused;
// keep it until a full locale set is actually bundled.
export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  type Locale,
} from './I18nProvider'
