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

export const SUPPORTED_LOCALES = [
  'en', 'zh-CN', 'zh-TW', 'fr', 'es', 'pt-BR', 'pt-PT', 'it',
  'de', 'ja', 'ko', 'ru', 'ar', 'hi', 'tr', 'pl', 'nl', 'sv',
  'da', 'no', 'fi', 'cs', 'hu', 'ro', 'th', 'vi', 'id', 'ms',
  'tl', 'uk', 'he', 'fa', 'bn', 'ur', 'gu', 'kn', 'ml', 'mr',
  'ta', 'te', 'pa', 'or', 'si', 'ne', 'my', 'km', 'el', 'bg',
  'hr', 'sk', 'sr', 'lt', 'az', 'uz', 'sw', 'ha', 'yo', 'ig',
  'am', 'ka',
] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'zh-CN'

// `navigator.language` returns values like `zh`, `zh-CN`, `fr-CA`, `pt-BR`,
// `es-419`, `en-US`. We snap to the closest supported locale (match on the
// primary subtag) so first-visit detection is forgiving — e.g. a `zh-Hans`
// browser still gets our `zh-CN` strings and a `pt-PT` browser gets `pt-BR`.
function detectLocale(): Locale {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return DEFAULT_LOCALE
  }
  const stored = window.localStorage.getItem('freellmapi.locale')
  if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
    return stored as Locale
  }
  const nav = navigator.language || (navigator as { userLanguage?: string }).userLanguage || ''
  const lower = nav.toLowerCase()
  if (lower.startsWith('zh')) return 'zh-CN'
  if (lower.startsWith('pt')) return 'pt-BR'
  if (lower.startsWith('fr')) return 'fr'
  if (lower.startsWith('es')) return 'es'
  if (lower.startsWith('it')) return 'it'
  if (lower.startsWith('de')) return 'de'
  if (lower.startsWith('ja')) return 'ja'
  if (lower.startsWith('ko')) return 'ko'
  if (lower.startsWith('ru')) return 'ru'
  if (lower.startsWith('ar')) return 'ar'
  if (lower.startsWith('hi')) return 'hi'
  if (lower.startsWith('tr')) return 'tr'
  if (lower.startsWith('pl')) return 'pl'
  if (lower.startsWith('nl')) return 'nl'
  if (lower.startsWith('sv')) return 'sv'
  if (lower.startsWith('da')) return 'da'
  if (lower.startsWith('no')) return 'no'
  if (lower.startsWith('fi')) return 'fi'
  if (lower.startsWith('cs')) return 'cs'
  if (lower.startsWith('hu')) return 'hu'
  if (lower.startsWith('ro')) return 'ro'
  if (lower.startsWith('th')) return 'th'
  if (lower.startsWith('vi')) return 'vi'
  if (lower.startsWith('id')) return 'id'
  if (lower.startsWith('ms')) return 'ms'
  if (lower.startsWith('tl')) return 'tl'
  if (lower.startsWith('uk')) return 'uk'
  if (lower.startsWith('he')) return 'he'
  if (lower.startsWith('fa')) return 'fa'
  if (lower.startsWith('bn')) return 'bn'
  if (lower.startsWith('ur')) return 'ur'
  if (lower.startsWith('gu')) return 'gu'
  if (lower.startsWith('kn')) return 'kn'
  if (lower.startsWith('ml')) return 'ml'
  if (lower.startsWith('mr')) return 'mr'
  if (lower.startsWith('ta')) return 'ta'
  if (lower.startsWith('te')) return 'te'
  if (lower.startsWith('pa')) return 'pa'
  if (lower.startsWith('or')) return 'or'
  if (lower.startsWith('si')) return 'si'
  if (lower.startsWith('ne')) return 'ne'
  if (lower.startsWith('my')) return 'my'
  if (lower.startsWith('km')) return 'km'
  if (lower.startsWith('el')) return 'el'
  if (lower.startsWith('bg')) return 'bg'
  if (lower.startsWith('hr')) return 'hr'
  if (lower.startsWith('sk')) return 'sk'
  if (lower.startsWith('sr')) return 'sr'
  if (lower.startsWith('lt')) return 'lt'
  if (lower.startsWith('az')) return 'az'
  if (lower.startsWith('uz')) return 'uz'
  if (lower.startsWith('sw')) return 'sw'
  if (lower.startsWith('ha')) return 'ha'
  if (lower.startsWith('yo')) return 'yo'
  if (lower.startsWith('ig')) return 'ig'
  if (lower.startsWith('am')) return 'am'
  if (lower.startsWith('ka')) return 'ka'
  if (lower.startsWith('en')) return 'en'
  return DEFAULT_LOCALE
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
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectLocale())

  // Persist + keep <html lang> in sync so screen readers and CSS `:lang()` rules
  // see the right language attribute.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('freellmapi.locale', locale)
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(next)) {
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
        // Fallback to English so a partial zh-CN still renders something.
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
