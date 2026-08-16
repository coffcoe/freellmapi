// client/src/i18n/index.js
import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN.json'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN }
})