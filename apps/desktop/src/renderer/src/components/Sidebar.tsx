import { HardDrive, LayoutGrid, Settings, Shield, ShieldCheck, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Language } from '../../../shared/ipc'
import { cn } from '../lib/format'

export type View = 'catalog' | 'library' | 'settings' | 'logs'

const navItems = [
  { id: 'catalog', icon: LayoutGrid, key: 'nav.catalog' },
  { id: 'library', icon: HardDrive, key: 'nav.library' },
  { id: 'settings', icon: Settings, key: 'nav.settings' },
  { id: 'logs', icon: Terminal, key: 'nav.logs' },
] as const

export function Sidebar({
  view,
  onChange,
  installedCount,
  appVersion,
  isElevated,
  language,
  onLanguage,
}: {
  view: View
  onChange: (view: View) => void
  installedCount: number
  appVersion: string
  isElevated: boolean
  language: Language
  onLanguage: (language: Language) => void
}) {
  const { t } = useTranslation()

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-panel/60">
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <div className="relative flex size-10 items-center justify-center rounded-xl border border-line bg-panel-2">
          <span className="font-display text-sm font-bold tracking-tight text-bone">EZ</span>
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-acid shadow-[0_0_10px_rgba(183,240,74,0.8)]" />
        </div>
        <div>
          <div className="font-display text-[15px] font-bold leading-none tracking-tight text-bone">
            {t('app.name')}
          </div>
          <div className="mt-1 text-[9px] font-semibold tracking-[0.18em] text-acid">
            {t('app.suffix')}
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-acid/10 text-bone'
                  : 'text-muted hover:bg-white/[0.04] hover:text-bone',
              )}
            >
              <Icon
                className={cn(
                  'size-[18px] transition-colors',
                  active ? 'text-acid' : 'text-muted group-hover:text-bone',
                )}
              />
              <span className="flex-1 text-left">{t(item.key)}</span>
              {item.id === 'library' && installedCount > 0 ? (
                <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                  {installedCount}
                </span>
              ) : null}
              {active ? <span className="h-4 w-0.5 rounded-full bg-acid" /> : null}
            </button>
          )
        })}
      </nav>

      <div className="space-y-3 border-t border-line px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            {t('app.language')}
          </span>
          <div className="flex rounded-lg border border-line bg-panel-2 p-0.5">
            {(['en', 'pt-BR'] as const).map((code) => (
              <button
                key={code}
                onClick={() => onLanguage(code)}
                className={cn(
                  'rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors',
                  language === code ? 'bg-acid text-ink' : 'text-muted hover:text-bone',
                )}
              >
                {code === 'en' ? 'EN' : 'PT'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted">
          {isElevated ? (
            <ShieldCheck className="size-3.5 text-acid" />
          ) : (
            <Shield className="size-3.5" />
          )}
          <span className="truncate">{isElevated ? t('app.admin') : t('app.notAdmin')}</span>
        </div>

        <div className="flex items-center justify-between text-[10px] text-muted">
          <span>v{appVersion}</span>
          <span className="rounded-full border border-acid/25 bg-acid/10 px-2 py-0.5 font-semibold uppercase tracking-wider text-acid">
            {t('app.alpha')}
          </span>
        </div>
      </div>
    </aside>
  )
}
