'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useSite } from '@/components/site-provider'
import { friendlyError } from '@/lib/chain'

const NEXT_PAGE = '/invite'
const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL || 'https://github.com/ddbobo1/tapecat-core'

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.56 9.56 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

export function PassCta() {
  const router = useRouter()
  const { account, signIn } = useSite()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin() {
    setError('')
    if (account) {
      router.push(NEXT_PAGE)
      return
    }
    setPending(true)
    try {
      await signIn()
      router.push(NEXT_PAGE)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setPending(false)
    }
  }

  const status = account ? `钱包已连接 · ${account.slice(0, 6)}…${account.slice(-4)}` : '流片窗口 · $BEM'
  const buttonLabel = pending ? '等待钱包确认…' : '成为早期共建者'

  return (
    <section className="flex w-full flex-col justify-center md:w-5/12">
      <p className="flex items-center gap-2 font-sans text-xs leading-4 tracking-widest text-accent" aria-live="polite">
        <span className="size-2 rounded-full bg-accent shadow-[0_0_10px_rgba(47,191,98,0.9)]" aria-hidden="true" />
        <span>{status}</span>
      </p>

      <h1 className="mt-8 text-6xl font-bold uppercase leading-none tracking-tighter text-foreground lg:text-8xl">
        TapeCat
      </h1>

      <p className="mt-8 text-pretty text-base leading-relaxed text-muted-foreground lg:text-lg">
        没人见过 TAPECAT 的脸。猫耳头套、白色墨镜、一双铬金属机械爪，它把芯片、晶体管和 NAND
        门一张张拍上桌，像排 Tier List 一样给链上项目排位。
      </p>

      <div className="mt-10 grid grid-cols-2 gap-3">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-accent/60 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <GitHubIcon className="size-4 shrink-0" />
          GitHub
        </a>
        <button
          type="button"
          onClick={handleJoin}
          disabled={pending}
          className="flex h-12 items-center justify-center whitespace-nowrap rounded-lg bg-accent px-3 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {buttonLabel}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="mt-8 text-pretty text-xs leading-relaxed text-muted-foreground">
        我们的故事，由一个代币开始……
      </p>
    </section>
  )
}
