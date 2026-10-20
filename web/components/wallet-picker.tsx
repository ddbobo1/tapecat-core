'use client'

import { useEffect, useId } from 'react'
import { Wallet, X } from 'lucide-react'
import { INSTALL_WALLETS, type WalletOption } from '@/lib/wallets'

export function WalletPicker({
  open,
  options,
  checking,
  activeRdns,
  onSelect,
  onClose,
}: {
  open: boolean
  options: WalletOption[]
  checking: boolean
  activeRdns: string | null
  onSelect: (option: WalletOption) => void
  onClose: () => void
}) {
  const titleId = useId()
  const injected = options.filter((option) => option.kind !== 'walletconnect')
  const showInstall = !checking && injected.length === 0

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-md flex-col gap-4 overflow-hidden rounded-xl border border-border bg-card p-6 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7),0_0_24px_-10px_rgba(47,191,98,0.45)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">WALLET</span>
            <h2 id={titleId} className="text-xl font-semibold text-foreground">
              选择钱包
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {checking && injected.length === 0 && (
          <p className="text-sm text-muted-foreground">正在检测已安装的钱包…</p>
        )}

        {options.length > 0 && (
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {options.map((option) => {
              const active = option.rdns === activeRdns
              return (
                <li key={option.rdns}>
                  <button
                    type="button"
                    onClick={() => onSelect(option)}
                    aria-label={`连接 ${option.name}`}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-accent/60 hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
                      {option.icon ? (
                        <img src={option.icon} alt="" className="size-9 object-cover" />
                      ) : (
                        <Wallet className="size-4 text-accent" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{option.name}</span>
                    {active && <span className="font-mono text-[10px] uppercase tracking-wider text-accent">当前</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {showInstall && (
          <div className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {options.length > 0 ? '也可以安装浏览器钱包：' : '未检测到浏览器钱包。安装其中一个后再连接：'}
            </p>
            <ul className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
              {INSTALL_WALLETS.map((wallet) => (
                <li key={wallet.name}>
                  <a
                    href={wallet.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-11 items-center justify-between rounded-lg border border-border px-3 text-sm text-foreground transition-colors hover:border-accent/60 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {wallet.name}
                    <span aria-hidden="true">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
