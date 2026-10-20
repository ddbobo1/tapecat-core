'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy, UserPlus, X } from 'lucide-react'
import { useSite } from '@/components/site-provider'
import { friendlyError } from '@/lib/chain'

export function InvitePopover() {
  const { account, connect } = useSite()
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const link =
    account && typeof window !== 'undefined' ? `${window.location.origin}/invite?ref=${account}` : ''
  const shortLink = account ? `…/invite?ref=${account.slice(0, 6)}…${account.slice(-4)}` : ''

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="邀请好友"
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card/60 px-2.5 text-muted-foreground transition-colors hover:border-accent/60 hover:text-accent aria-expanded:border-accent/60 aria-expanded:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <UserPlus className="size-4" aria-hidden="true" />
        <span className="hidden text-sm sm:inline">邀请</span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={`${panelId}-title`}
          className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7),0_0_24px_-10px_rgba(47,191,98,0.6)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                REFERRAL.PROTOCOL
              </span>
              <h2 id={`${panelId}-title`} className="text-base font-semibold text-foreground">
                邀请好友参与
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            好友通过你的链接参与，你获得 <span className="font-medium text-accent">10% 返佣</span>。
          </p>

          <div className="mt-4">
            {account ? (
              <div className="flex items-center gap-2">
                <code className="flex h-9 min-w-0 flex-1 items-center truncate rounded-lg border border-border bg-background px-3 font-mono text-xs text-muted-foreground">
                  {shortLink}
                </code>
                <button
                  type="button"
                  onClick={copy}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPending(true)
                  setError('')
                  connect()
                    .catch((e) => setError(friendlyError(e)))
                    .finally(() => setPending(false))
                }}
                disabled={pending}
                className="flex h-9 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {pending ? '连接中…' : '连接钱包生成邀请链接'}
              </button>
            )}
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <span className="sr-only" aria-live="polite">
              {copied ? '邀请链接已复制' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
