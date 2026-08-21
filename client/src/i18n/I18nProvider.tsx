/**
 * Lightweight i18n for the dashboard.
 *
 * - Zero external dependencies (no react-i18next, no Intl polyfills)
 * - Locale data is imported as JSON (en, zh-CN) — adding a new locale is a
 *   single file under `locales/` plus a registration in `LOCALES` below.
 * - Locale preference is persisted in `localStorage` under
 *   `freellmapi.locale` and falls back to `navigator.language` on first visit
 *   (snapped to the closest supported locale).
 * - The provider re-renders synchronously on `setLocale`, so all `t()` calls
 *   pick up the new strings without page reload.
 *
 * Translation keys use dot notation, e.g. `nav.models` or `premium.renewsOn`.
 * `t()` does a single dotted lookup; unknown keys return the key itself
 * rather than throwing, so partial translations degrade gracefully.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import fr from './locales/fr.json'
import es from './locales/es.json'
import ptBR from './locales/pt-BR.json'
import it from './locales/it.json'
import de from './locales/de.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import ar from './locales/ar.json'
import hi from './locales/hi.json'
import tr from './locales/tr.json'
import pl from './locales/pl.json'
import nl from './locales/nl.json'
import sv from './locales/sv.json'
import da from './locales/da.json'
import no from './locales/no.json'
import fi from './locales/fi.json'
import cs from './locales/cs.json'
import hu from './locales/hu.json'
import ro from './locales/ro.json'
import th from './locales/th.json'
import vi from './locales/vi.json'
import id from './locales/id.json'
import ms from './locales/ms.json'
import tl from './locales/tl.json'
import uk from './locales/uk.json'
import he from './locales/he.json'
import fa from './locales/fa.json'
import bn from './locales/bn.json'
import ur from './locales/ur.json'
import gu from './locales/gu.json'
import kn from './locales/kn.json'
import ml from './locales/ml.json'
import mr from './locales/mr.json'
import ta from './locales/ta.json'
import te from './locales/te.json'
import pa from './locales/pa.json'
import or from './locales/or.json'
import si from './locales/si.json'
import ne from './locales/ne.json'
import my from './locales/my.json'
import km from './locales/km.json'
import el from './locales/el.json'
import bg from './locales/bg.json'
import hr from './locales/hr.json'
import sk from './locales/sk.json'
import sr from './locales/sr.json'
import lt from './locales/lt.json'
import az from './locales/az.json'
import uz from './locales/uz.json'
import sw from './locales/sw.json'
import ha from './locales/ha.json'
import yo from './locales/yo.json'
import ig from './locales/ig.json'
import am from './locales/am.json'
import ka from './locales/ka.json'
import ptPT from './locales/pt-PT.json'
import zhTW from './locales/zh-TW.json'

// Use Set for fast lookup to prevent Vite 8 from optimizing to string.split()
// which corrupts hyphenated locale codes like zh-CN -> zh, CN
export const SUPPORTED_LOCALES_SET: ReadonlySet<string> = new Set([
  'en', 'zh-CN', 'zh-TW', 'fr', 'es', 'pt-BR', 'pt-PT', 'it',
  'de', 'ja', 'ko', 'ru', 'ar', 'hi', 'tr', 'pl', 'nl', 'sv',
  'da', 'no', 'fi', 'cs', 'hu', 'ro', 'th', 'vi', 'id', 'ms',
  'tl', 'uk', 'he', 'fa', 'bn', 'ur', 'gu', 'kn', 'ml', 'mr',
  'ta', 'te', 'pa', 'or', 'si', 'ne', 'my', 'km', 'el', 'bg',
  'hr', 'sk', 'sr', 'lt', 'az', 'uz', 'sw', 'ha', 'yo', 'ig',
  'am', 'ka',
])
// Keep array for iteration (settings dialog needs .map())
export const SUPPORTED_LOCALES: readonly string[] = Array.from(SUPPORTED_LOCALES_SET)

export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

// `navigator.language` returns values like `zh`, `zh-CN`, `fr-CA`, `pt-BR`,
// `es-419`, `en-US`. We snap to the closest supported locale (match on the
// primary subtag) so first-visit detection is forgiving — e.g. a `zh-Hans`
// browser still gets our `zh-CN` strings and a `pt-PT` browser gets `pt-BR`.
function detectLocale(): Locale {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return DEFAULT_LOCALE
  }
  // Only respect localStorage if user explicitly chose a non-default locale
  // If browser is Chinese but localStorage says 'en', prefer browser language
  const nav = navigator.language || (navigator as { userLanguage?: string }).userLanguage || ''
  const lower = nav.toLowerCase()

  // Detect browser locale first
  let browserLocale: Locale | null = null
  if (lower.startsWith('zh')) browserLocale = 'zh-CN'
  else if (lower.startsWith('pt')) browserLocale = 'pt-BR'
  else if (lower.startsWith('fr')) browserLocale = 'fr'
  else if (lower.startsWith('es')) browserLocale = 'es'
  else if (lower.startsWith('it')) browserLocale = 'it'
  else if (lower.startsWith('de')) browserLocale = 'de'
  else if (lower.startsWith('ja')) browserLocale = 'ja'
  else if (lower.startsWith('ko')) browserLocale = 'ko'
  else if (lower.startsWith('ru')) browserLocale = 'ru'
  else if (lower.startsWith('ar')) browserLocale = 'ar'
  else if (lower.startsWith('hi')) browserLocale = 'hi'
  else if (lower.startsWith('tr')) browserLocale = 'tr'
  else if (lower.startsWith('pl')) browserLocale = 'pl'
  else if (lower.startsWith('nl')) browserLocale = 'nl'
  else if (lower.startsWith('sv')) browserLocale = 'sv'
  else if (lower.startsWith('da')) browserLocale = 'da'
  else if (lower.startsWith('no')) browserLocale = 'no'
  else if (lower.startsWith('fi')) browserLocale = 'fi'
  else if (lower.startsWith('cs')) browserLocale = 'cs'
  else if (lower.startsWith('hu')) browserLocale = 'hu'
  else if (lower.startsWith('ro')) browserLocale = 'ro'
  else if (lower.startsWith('th')) browserLocale = 'th'
  else if (lower.startsWith('vi')) browserLocale = 'vi'
  else if (lower.startsWith('id')) browserLocale = 'id'
  else if (lower.startsWith('ms')) browserLocale = 'ms'
  else if (lower.startsWith('tl')) browserLocale = 'tl'
  else if (lower.startsWith('uk')) browserLocale = 'uk'
  else if (lower.startsWith('he')) browserLocale = 'he'
  else if (lower.startsWith('fa')) browserLocale = 'fa'
  else if (lower.startsWith('bn')) browserLocale = 'bn'
  else if (lower.startsWith('ur')) browserLocale = 'ur'
  else if (lower.startsWith('gu')) browserLocale = 'gu'
  else if (lower.startsWith('kn')) browserLocale = 'kn'
  else if (lower.startsWith('ml')) browserLocale = 'ml'
  else if (lower.startsWith('mr')) browserLocale = 'mr'
  else if (lower.startsWith('ta')) browserLocale = 'ta'
  else if (lower.startsWith('te')) browserLocale = 'te'
  else if (lower.startsWith('pa')) browserLocale = 'pa'
  else if (lower.startsWith('or')) browserLocale = 'or'
  else if (lower.startsWith('si')) browserLocale = 'si'
  else if (lower.startsWith('ne')) browserLocale = 'ne'
  else if (lower.startsWith('my')) browserLocale = 'my'
  else if (lower.startsWith('km')) browserLocale = 'km'
  else if (lower.startsWith('el')) browserLocale = 'el'
  else if (lower.startsWith('bg')) browserLocale = 'bg'
  else if (lower.startsWith('hr')) browserLocale = 'hr'
  else if (lower.startsWith('sk')) browserLocale = 'sk'
  else if (lower.startsWith('sr')) browserLocale = 'sr'
  else if (lower.startsWith('lt')) browserLocale = 'lt'
  else if (lower.startsWith('az')) browserLocale = 'az'
  else if (lower.startsWith('uz')) browserLocale = 'uz'
  else if (lower.startsWith('sw')) browserLocale = 'sw'
  else if (lower.startsWith('ha')) browserLocale = 'ha'
  else if (lower.startsWith('yo')) browserLocale = 'yo'
  else if (lower.startsWith('ig')) browserLocale = 'ig'
  else if (lower.startsWith('am')) browserLocale = 'am'
  else if (lower.startsWith('ka')) browserLocale = 'ka'
  else if (lower.startsWith('en')) browserLocale = 'en'

  const stored = window.localStorage.getItem('freellmapi.locale')
  // Only use stored locale if browser language is NOT detected
  // This ensures Chinese browser users always get Chinese UI
  if (stored && SUPPORTED_LOCALES_SET.has(stored) && !browserLocale) {
    return stored as Locale
  }

  // Return browser locale if detected, otherwise DEFAULT_LOCALE
  return browserLocale ?? DEFAULT_LOCALE
}

type Dictionary = Record<string, unknown>

const dictionaries: Record<Locale, Dictionary> = {
  en, 'zh-CN': zhCN, 'zh-TW': zhTW, fr, es, 'pt-BR': ptBR, 'pt-PT': ptPT, it,
  de, ja, ko, ru, ar, hi, tr, pl, nl, sv, da, no, fi, cs, hu, ro, th, vi, id, ms,
  tl, uk, he, fa, bn, ur, gu, kn, ml, mr, ta, te, pa, or, si, ne, my, km, el, bg,
  hr, sk, sr, lt, az, uz, sw, ha, yo, ig, am, ka,
} as const

function lookup(dict: Dictionary, key: string): unknown {
  // Walk the dot path; return the literal key when a segment is missing so
  // the UI never blanks out for an untranslated string.
  const segments = key.split('.')
  let cur: unknown = dict
  for (const seg of segments) {
    if (cur && typeof cur === 'object' && seg in (cur as Dictionary)) {
      cur = (cur as Dictionary)[seg]
    } else {
      return undefined
    }
  }
  return cur
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null ? `{${name}}` : String(v)
  })
}

interface I18nContextValue {
  locale: Locale
  setLocale: (next: Locale) => void
  t: (key: string, vars?: Record<string, string | number>) => string
  /** Cycle to the next supported locale. Handy for a toggle button. */
  toggleLocale: () => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

export interface I18nProviderProps {
  children: ReactNode
  /** Optional override for tests; defaults to the detector. */
  initialLocale?: Locale
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const detected = initialLocale ?? detectLocale()
  const [locale, setLocaleState] = useState<Locale>(detected)

  // Persist + keep <html lang> in sync so screen readers and CSS `:lang()` rules
  // see the right language attribute.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('freellmapi.locale', locale)
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    if (SUPPORTED_LOCALES_SET.has(next)) {
      setLocaleState(next)
    }
  }, [])

  const toggleLocale = useCallback(() => {
    setLocaleState((cur) => {
      const i = SUPPORTED_LOCALES.indexOf(cur)
      return SUPPORTED_LOCALES[(i + 1) % SUPPORTED_LOCALES.length]
    })
  }, [])

  const value = useMemo<I18nContextValue>(() => {
    const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE]
    return {
      locale,
      setLocale,
      toggleLocale,
      t: (key, vars) => {
        const raw = lookup(dict, key)
        if (typeof raw === 'string') return interpolate(raw, vars)
        // Fallback to DEFAULT_LOCALE (zh-CN) so Chinese UI always renders properly
        const fallback = lookup(dictionaries[DEFAULT_LOCALE], key)
        if (typeof fallback === 'string') return interpolate(fallback, vars)
        return key
      },
    }
  }, [locale, setLocale, toggleLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    // Safe default so components used outside the provider (e.g. in tests)
    // don't throw — they just render the key strings.
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      toggleLocale: () => {},
      t: (key) => key,
    }
  }
  return ctx
}
