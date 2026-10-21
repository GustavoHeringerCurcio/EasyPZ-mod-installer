import { AlertTriangle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui'

export interface ConfirmRequest {
  title: string
  body: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => Promise<void> | void
}

export function ConfirmDialog({
  request,
  loading,
  onCancel,
  onConfirm,
}: {
  request: ConfirmRequest
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/85 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-line bg-panel p-6 shadow-[0_30px_100px_rgba(0,0,0,0.6)]">
        <div className="flex items-start justify-between">
          <div
            className={
              request.destructive
                ? 'flex size-11 items-center justify-center rounded-xl border border-danger/30 bg-danger/10'
                : 'flex size-11 items-center justify-center rounded-xl border border-line bg-panel-2'
            }
          >
            <AlertTriangle
              className={request.destructive ? 'size-5 text-danger' : 'size-5 text-bone'}
            />
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-bone disabled:opacity-40"
            aria-label={t('common.close')}
          >
            <X className="size-4" />
          </button>
        </div>
        <h2 className="mt-4 font-display text-xl font-bold text-bone">{request.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{request.body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={request.destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
