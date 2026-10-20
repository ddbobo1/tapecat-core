'use client'

import { useEffect, useRef, useState } from 'react'
import { Wallet } from 'lucide-react'
import { useSite } from '@/components/site-provider'

export function WalletButton() {
  const { account, connect, disconnect, signIn } = useSite()
  const [pending, setPending] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!account) setMenuOpen(false)
  }, [account])

  async function onClick() {
    if (pending) return
    if (account) {
      setMenuOpen((open) => !open)
      return
    }
    setPending(true)
    try {
      await signIn()
    } catch {
      // User rejected the wallet, the signature, or the risk disclosure.
    } finally {
      setPending(false)
    }
  }

  async function onSwitch() {
    setMenuOpen(false)
    if (pending) return
    setPending(true)
    try {
      await connect({ choose: true })
      await signIn()
    } catch {
      // User rejected the wallet, the signature, or the risk disclosure.
    } finally {
      setPending(false)
    }
  }

  async function onDisconnect() {
    setMenuOpen(false)
    try {
      await disconnect()
    } catch {
      // Local account, remembered wallet, and the SIWE cookie are cleared even if logout fails.
    }
  }

  const label = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : pending ? '连接中…' : '连接钱包'

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-expanded={account ? menuOpen : undefined}
        aria-haspopup={account ? 'menu' : undefined}
        aria-label={account ? `已连接钱包 ${account}` : '连接钱包'}
        className="flex h-9 items-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-2.5 font-mono text-xs uppercase tracking-wider text-accent shadow-[0_0_18px_-6px_rgba(47,191,98,0.8)] transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-3"
      >
        <Wallet className="size-4" aria-hidden="true" />
        <span className={account ? 'hidden sm:inline' : 'hidden font-sans text-sm normal-case tracking-normal sm:inline'}>
          {label}
        </span>
      </button>
      {menuOpen && account && (
        <div
          role="menu"
          aria-label="钱包"
          className="absolute right-0 top-full z-40 mt-2 w-40 rounded-xl border border-border bg-card p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7),0_0_24px_-10px_rgba(47,191,98,0.6)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onSwitch}
            className="flex h-9 w-full items-center rounded-lg px-3 text-left text-sm text-foreground transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            切换钱包
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onDisconnect}
            className="flex h-9 w-full items-center rounded-lg px-3 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring"
          >
            断开连接
          </button>
        </div>
      )}
    </div>
  )
}
