/**
 * Lightweight, lazy-loaded i18n for the dashboard.
 *
 * English stays in the initial bundle as the always-available fallback. Vite
 * discovers every other JSON dictionary at build time and emits one chunk per
 * locale; switching locale loads only that dictionary.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import en from './locales/en.json'
import { I18nContext, type I18nContextValue } from './context'
import {
  DEFAULT_LOCALE,
  RTL_LOCALES,
  SUPPORTED_LOCALES,
  type Locale,
} from './locale-config'

const supportedLocaleSet = new Set<string>(SUPPORTED_LOCALES)
const supportedByLowerCase = new Map(
  SUPPORTED_LOCALES.map(locale => [locale.toLowerCase(), locale]),
)

function matchBrowserLocale(browserLocale: string): Locale | null {
  const normalized = browserLocale.replace('_', '-').toLowerCase()
  const exact = supportedByLowerCase.get(normalized)
  if (exact) return exact

  const [primary, regionOrScript] = normalized.split('-')
  if (primary === 'zh') {
    return regionOrScript === 'tw'
      || regionOrScript === 'hk'
      || regionOrScript === 'mo'
      || regionOrScript === 'hant'
      ? 'zh-TW'
      : 'zh-CN'
  }
  if (primary === 'pt') return regionOrScript === 'pt' ? 'pt-PT' : 'pt-BR'
  // Browsers report Norwegian as nb/nn and Filipino as fil; snap those to
  // our nearest dictionaries.
  if (primary === 'nb' || primary === 'nn') return 'no'
  if (primary === 'fil') return 'tl'

  return supportedByLowerCase.get(primary) ?? null
}

function detectLocale(): Locale {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return DEFAULT_LOCALE
  }

  // Prefer browser language over localStorage cache
  // This fixes the issue where a Chinese browser user with 'en' in localStorage
  // would still see English UI
  const nav = navigator.language || (navigator as { userLanguage?: string }).userLanguage || ''
  const lower = nav.toLowerCase()

  // Try to detect browser locale first
  let browserLocale: Locale | null = null

  // Check primary subtag first
  const parts = lower.split('-')
  const primary = parts[0]

  if (primary === 'zh') browserLocale = 'zh-CN'
  else if (primary === 'pt') browserLocale = 'pt-BR'
  else if (primary === 'fr') browserLocale = 'fr'
  else if (primary === 'es') browserLocale = 'es'
  else if (primary === 'it') browserLocale = 'it'
  else if (primary === 'de') browserLocale = 'de'
  else if (primary === 'ja') browserLocale = 'ja'
  else if (primary === 'ko') browserLocale = 'ko'
  else if (primary === 'ru') browserLocale = 'ru'
  else if (primary === 'ar') browserLocale = 'ar'
  else if (primary === 'hi') browserLocale = 'hi'
  else if (primary === 'tr') browserLocale = 'tr'
  else if (primary === 'pl') browserLocale = 'pl'
  else if (primary === 'nl') browserLocale = 'nl'
  else if (primary === 'sv') browserLocale = 'sv'
  else if (primary === 'da') browserLocale = 'da'
  else if (primary === 'no') browserLocale = 'no'
  else if (primary === 'fi') browserLocale = 'fi'
  else if (primary === 'cs') browserLocale = 'cs'
  else if (primary === 'hu') browserLocale = 'hu'
  else if (primary === 'ro') browserLocale = 'ro'
  else if (primary === 'th') browserLocale = 'th'
  else if (primary === 'vi') browserLocale = 'vi'
  else if (primary === 'id') browserLocale = 'id'
  else if (primary === 'ms') browserLocale = 'ms'
  else if (primary === 'tl') browserLocale = 'tl'
  else if (primary === 'uk') browserLocale = 'uk'
  else if (primary === 'he') browserLocale = 'he'
  else if (primary === 'fa') browserLocale = 'fa'
  else if (primary === 'bn') browserLocale = 'bn'
  else if (primary === 'ur') browserLocale = 'ur'
  else if (primary === 'gu') browserLocale = 'gu'
  else if (primary === 'kn') browserLocale = 'kn'
  else if (primary === 'ml') browserLocale = 'ml'
  else if (primary === 'mr') browserLocale = 'mr'
  else if (primary === 'ta') browserLocale = 'ta'
  else if (primary === 'te') browserLocale = 'te'
  else if (primary === 'pa') browserLocale = 'pa'
  else if (primary === 'or') browserLocale = 'or'
  else if (primary === 'si') browserLocale = 'si'
  else if (primary === 'ne') browserLocale = 'ne'
  else if (primary === 'my') browserLocale = 'my'
  else if (primary === 'km') browserLocale = 'km'
  else if (primary === 'el') browserLocale = 'el'
  else if (primary === 'bg') browserLocale = 'bg'
  else if (primary === 'hr') browserLocale = 'hr'
  else if (primary === 'sk') browserLocale = 'sk'
  else if (primary === 'sr') browserLocale = 'sr'
  else if (primary === 'lt') browserLocale = 'lt'
  else if (primary === 'az') browserLocale = 'az'
  else if (primary === 'uz') browserLocale = 'uz'
  else if (primary === 'sw') browserLocale = 'sw'
  else if (primary === 'ha') browserLocale = 'ha'
  else if (primary === 'yo') browserLocale = 'yo'
  else if (primary === 'ig') browserLocale = 'ig'
  else if (primary === 'am') browserLocale = 'am'
  else if (primary === 'ka') browserLocale = 'ka'
  else if (primary === 'en') browserLocale = 'en'

  // Only use localStorage if browser language not detected
  // This ensures Chinese browser users always get Chinese UI
  const stored = window.localStorage.getItem('freellmapi.locale')
  if (stored && supportedLocaleSet.has(stored) && !browserLocale) {
    return stored as Locale
  }

  // Return browser locale if detected, otherwise localStorage or default
  return browserLocale ?? (stored as Locale ?? DEFAULT_LOCALE)
}

type Dictionary = Record<string, unknown>
type LocaleLoader = () => Promise<Dictionary>

// Lazy-load all locale JSON files except English
const localeModules = import.meta.glob<Dictionary>(
  ['./locales/*.json', '!./locales/en.json'],
  { import: 'default' },
)
const localeLoaders = Object.fromEntries(
  Object.entries(localeModules).map(([path, loader]) => {
    const locale = path.match(/\/([^/]+)\.json$/)?.[1]
    return [locale, loader]
  }),
) as Partial<Record<Locale, LocaleLoader>>

const loadedDictionaries: Partial<Record<Locale, Dictionary>> = {
  en: en as Dictionary,
}

function lookup(dictionary: Dictionary, key: string): unknown {
  const segments = key.split('.')
  let current: unknown = dictionary
  for (const segment of segments) {
    if (current && typeof current === 'object' && segment in (current as Dictionary)) {
      current = (current as Dictionary)[segment]
    } else {
      return undefined
    }
  }
  return current
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const value = vars[name]
    return value === undefined || value === null ? `{${name}}` : String(value)
  })
}

export interface I18nProviderProps {
  children: ReactNode
  initialLocale?: Locale
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectLocale())
  const [dictionary, setDictionary] = useState<Dictionary>(
    () => loadedDictionaries[initialLocale ?? DEFAULT_LOCALE] ?? (en as Dictionary),
  )

  useEffect(() => {
    window.localStorage.setItem('freellmapi.locale', locale)
    document.documentElement.lang = locale
    document.documentElement.dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'
  }, [locale])

  useEffect(() => {
    const load = localeLoaders[locale]
    if (!load) return

    let active = true
    void load()
      .then(nextDictionary => {
        loadedDictionaries[locale] = nextDictionary
        if (active) setDictionary(nextDictionary)
      })
      .catch(error => {
        console.error(`Failed to load locale "${locale}"`, error)
      })
    return () => {
      active = false
    }
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    if (!supportedLocaleSet.has(next)) return
    setLocaleState(next)
    const loaded = loadedDictionaries[next]
    if (loaded) setDictionary(loaded)
  }, [])

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key, vars) => {
      const raw = lookup(dictionary, key)
      if (typeof raw === 'string') return interpolate(raw, vars)
      const fallback = lookup(en as Dictionary, key)
      if (typeof fallback === 'string') return interpolate(fallback, vars)
      return key
    },
  }), [dictionary, locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
