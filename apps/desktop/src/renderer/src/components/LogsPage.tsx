import { FileText, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InstallLogLine } from '../lib/install'
import { Button, Panel } from './ui'
import { cn } from '../lib/format'

export function LogsPage({
  logs,
  onOpenLogs,
  onClear,
}: {
  logs: InstallLogLine[]
  onOpenLogs: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-bone">
            {t('logs.title')}
          </h1>
          <p className="mt-2 text-sm text-muted">{t('logs.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClear} disabled={logs.length === 0}>
            <Trash2 className="size-3.5" />
            {t('logs.clear')}
          </Button>
          <Button size="sm" onClick={onOpenLogs}>
            <FileText className="size-3.5" />
            {t('logs.open')}
          </Button>
        </div>
      </header>

      <Panel className="mt-6 overflow-hidden">
        {logs.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted">{t('logs.empty')}</div>
        ) : (
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
            {logs
              .slice()
              .reverse()
              .map((line, index) => (
                <div
                  key={`${line.at}-${index}`}
                  className={cn(
                    'flex gap-3 border-b border-line/40 py-1.5 last:border-0',
                    line.level === 'error'
                      ? 'text-danger/90'
                      : line.level === 'warn'
                        ? 'text-rust/90'
                        : 'text-muted',
                  )}
                >
                  <span className="shrink-0 text-muted/45">
                    {new Date(line.at).toLocaleTimeString()}
                  </span>
                  <span className="shrink-0 uppercase text-muted/60">{line.level}</span>
                  <span className="break-words">{line.message}</span>
                </div>
              ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
