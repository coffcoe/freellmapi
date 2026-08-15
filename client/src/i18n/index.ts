export {
  I18nProvider,
  useI18n,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  type Locale,
  type I18nContextValue,
  type I18nProviderProps,
} from './I18nProvider'
// NOTE: useI18n MUST come from I18nProvider — it reads the same context the
// provider renders. context.ts previously declared its OWN createContext, so
// every component's useContext() read a different (never-provided) context and
// t() fell back to returning the raw key (界面全显示 settings.title 等).
// locale-config.ts / context.ts are now unused; see 2026-08-13 memory.
