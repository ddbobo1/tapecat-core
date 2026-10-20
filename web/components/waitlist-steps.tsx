'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, useSite } from '@/components/site-provider'
import { apiUrl } from '@/lib/api-base'
import { friendlyError } from '@/lib/chain'
import { rememberOauthReturn } from '@/lib/oauth-return'

type Step = {
  title: string
  description: string
  action: string
}

type Me = {
  wallet: string | null
  x: { username: string } | null
}

const STEPS: Step[] = [
  { title: '登录', description: '用你自己的钱包签名。签名只证明归属，不花 gas。', action: '登录' },
  { title: '绑定你的 X', description: '关联 X 账号，方便我们确认你是真人。', action: '绑定 X' },
  { title: '关于你', description: '简单介绍一下你想在 TapeOut 上做什么。', action: '提交' },
]

export function WaitlistSteps() {
  const { geo, signIn } = useSite()
  const [current, setCurrent] = useState(0)
  const [about, setAbout] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const done = current >= STEPS.length

  useEffect(() => {
    let cancel = false
    const q = new URLSearchParams(window.location.search)
    api<Me>('/api/me')
      .then((me) => {
        if (cancel) return
        if (q.get('x_error')) setError(friendlyError(q.get('x_error')))
        if (me.x) setCurrent(2)
        else if (me.wallet || q.get('x') === 'ok') setCurrent(1)
      })
      .catch(() => {
        if (!cancel && q.get('x_error')) setError(friendlyError(q.get('x_error')))
      })
    return () => {
      cancel = true
    }
  }, [])

  async function login() {
    setBusy(true)
    setError('')
    try {
      if (geo?.blocked) throw new Error('region_restricted')
      await signIn()
      setCurrent(1)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function bindX() {
    setBusy(true)
    setError('')
    try {
      if (geo?.blocked) throw new Error('region_restricted')
      await signIn()
      const me = await api<Me>('/api/me')
      if (me.x) {
        setCurrent(2)
        setBusy(false)
        return
      }
      rememberOauthReturn('/waitlist')
      window.location.href = apiUrl('/api/x/login')
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <section className="flex w-full items-center justify-center px-6 py-16 md:min-h-screen md:w-1/2 md:px-10 lg:px-16">
      <div className="flex w-full max-w-md flex-col">
        <Link
          href="/"
          className="flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回
        </Link>

        <h1 className="mt-6 text-balance text-4xl font-medium leading-tight tracking-tight text-foreground sm:text-5xl">
          加入候补名单
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          TAPECAT / TapeOut 生态候补。想真正参与流片的人优先。
        </p>
        <ol className="mt-10 flex flex-col gap-3">
          {STEPS.map((step, index) => {
            const isActive = index === current
            const isComplete = index < current
            return (
              <li
                key={step.title}
                aria-current={isActive ? 'step' : undefined}
                className={cn(
                  'flex flex-col gap-4 rounded-md p-5 transition-colors',
                  isActive ? 'border border-border bg-background shadow-sm' : 'bg-muted',
                )}
              >
                <div className="flex items-center gap-4">
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                      isActive && 'bg-primary text-primary-foreground',
                      isComplete && 'bg-accent text-accent-foreground',
                      !isActive && !isComplete && 'bg-background text-muted-foreground',
                    )}
                  >
                    {isComplete ? <Check className="size-4" aria-label="已完成" /> : index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cn('font-medium', isActive || isComplete ? 'text-foreground' : 'text-muted-foreground')}>
                      {step.title}
                    </span>
                    {isActive && <span className="text-sm leading-relaxed text-muted-foreground">{step.description}</span>}
                  </div>
                  {isActive && index < 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (index === 0) void login()
                        else void bindX()
                      }}
                      disabled={busy}
                      className="flex h-11 shrink-0 items-center justify-center rounded-sm bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-70"
                    >
                      {step.action}
                    </button>
                  )}
                </div>

                {isActive && index === 2 && (
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (about.trim()) setCurrent(STEPS.length)
                    }}
                  >
                    <label htmlFor="about" className="sr-only">
                      关于你
                    </label>
                    <textarea
                      id="about"
                      required
                      maxLength={280}
                      rows={3}
                      value={about}
                      onChange={(e) => setAbout(e.target.value)}
                      placeholder="比如：做过 RISC-V 小核，想把它流片出来。"
                      className="resize-none rounded-sm border border-border bg-background p-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    />
                    <button
                      type="submit"
                      className="flex h-11 items-center justify-center rounded-sm bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {step.action}
                    </button>
                  </form>
                )}
              </li>
            )
          })}
        </ol>

        {error && (
          <p role="alert" className="mt-6 text-sm leading-relaxed text-destructive">
            {error}
          </p>
        )}

        {done && (
          <p role="status" className="mt-6 rounded-md bg-muted p-5 text-sm leading-relaxed text-foreground">
            你已进入候补名单，邀请码发放时会通过 X 通知你。
          </p>
        )}
      </div>
    </section>
  )
}
