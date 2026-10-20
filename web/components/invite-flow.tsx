'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowUpRight, Check, Repeat2, Wallet } from 'lucide-react'
import { formatUnits, parseUnits, type Hex } from 'viem'
import { ArtPanel } from '@/components/pass-art'
import { EcosystemMarquee } from '@/components/ecosystem-marquee'
import { SiteHeader } from '@/components/site-header'
import { ApiError, api, useSite } from '@/components/site-provider'
import { apiUrl } from '@/lib/api-base'
import { erc20Abi, friendlyError } from '@/lib/chain'
import { OAUTH_RETURN_KEY, OAUTH_TASK_KEY, rememberOauthReturn } from '@/lib/oauth-return'

const X_HANDLE = 'TapeCat_'

type TaskId = 'follow' | 'engage'

type Me = {
  wallet: string | null
  x: { username: string; followed: boolean; retweeted: boolean; cap: string } | null
}

type Alloc = {
  xIdHash: Hex
  cap: string
  deadline: string
  sig: Hex
  followed: boolean
  retweeted: boolean
}

const SOCIAL_TASKS: {
  id: TaskId
  step: string
  title: string
  reward: number
  action: string
  Icon: React.ComponentType<{ className?: string }>
}[] = [
  {
    id: 'follow',
    step: 'TASK.01',
    title: `连接 X 并关注 @${X_HANDLE}`,
    reward: 1,
    action: '去关注',
    Icon: XGlyph,
  },
  {
    id: 'engage',
    step: 'TASK.02',
    title: '点赞并转发置顶推文',
    reward: 0.5,
    action: '去转发',
    Icon: Repeat2,
  },
]

function XGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

const MIN_BEM = parseUnits('0.1', 8)
const MAX_QUOTA = 1.5

function SubscribeCountdown({
  deadlineMs,
  onRestart,
}: {
  /** Unix ms when the raise ends. `null` while the sale has not loaded. `0` when it is closed. */
  deadlineMs: number | null
  onRestart: () => void
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [])

  if (deadlineMs == null) {
    return (
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-xs text-muted-foreground">流片窗口</span>
        <span className="font-mono text-xl font-medium tabular-nums leading-none text-accent">--:--:--</span>
      </div>
    )
  }

  const left = deadlineMs > 0 ? Math.max(0, Math.ceil((deadlineMs - now) / 1000)) : 0
  const hours = Math.floor(left / 3600)
  const minutes = Math.floor((left % 3600) / 60)
  const seconds = left % 60
  const clock = [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':')
  const urgent = left > 0 && left <= 10 * 60

  if (left === 0) {
    return (
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground">WINDOW.CLOSED</span>
        <button
          type="button"
          onClick={onRestart}
          className="text-sm font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          重新开启
        </button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5">
      <span className="text-xs text-muted-foreground">流片窗口</span>
      <span
        role="timer"
        aria-label={`流片窗口剩余 ${hours} 小时 ${minutes} 分 ${seconds} 秒`}
        className={`font-mono text-xl font-medium tabular-nums leading-none ${urgent ? 'text-destructive' : 'text-accent'}`}
      >
        {clock}
      </span>
    </div>
  )
}

function formatBem(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

function parseBem(input: string): bigint | null {
  const trimmed = input.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  try {
    return parseUnits(trimmed, 8)
  } catch {
    return null
  }
}

function quotaOf(done: Record<TaskId, boolean>, cap: bigint) {
  if (cap > 0n) return Number(formatUnits(cap, 8))
  if (!done.follow) return 0
  return done.engage ? 1.5 : 1
}

export function InviteFlow() {
  const router = useRouter()
  const { cfg, account, sale, geo, referrer, pub, connect, signIn, requireTerms, send, refresh } = useSite()
  const [done, setDone] = useState<Record<TaskId, boolean>>({ follow: false, engage: false })
  const [storedCap, setStoredCap] = useState(0n)
  const [alloc, setAlloc] = useState<Alloc | null>(null)
  const [checking, setChecking] = useState<TaskId | null>(null)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [sessionFunded, setSessionFunded] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const oauthHandled = useRef(false)

  const xHandle = cfg?.xHandle || X_HANDLE
  const followUrl = `https://x.com/intent/follow?screen_name=${encodeURIComponent(xHandle)}`
  const engageUrl = cfg?.campaignTweetId
    ? `https://x.com/intent/retweet?tweet_id=${encodeURIComponent(cfg.campaignTweetId)}`
    : `https://x.com/${encodeURIComponent(xHandle)}`

  const quota = quotaOf(done, storedCap)
  const contributed = sale?.contributed ?? 0n
  const fundedLabel =
    contributed > 0n ? formatUnits(contributed, 8) : sessionFunded != null ? formatBem(sessionFunded) : null
  const raising = !!sale && sale.phase === 1 && sale.endTime > BigInt(Math.floor(Date.now() / 1000))
  const deadlineMs = !sale ? null : raising ? Number(sale.endTime) * 1000 : 0
  const windowClosed = sale != null && !raising
  const locked = quota === 0 || windowClosed

  const applyFlags = useCallback((followed: boolean, retweeted: boolean, cap?: bigint) => {
    setDone({ follow: followed, engage: retweeted })
    if (cap != null) setStoredCap(cap)
  }, [])

  const loadMe = useCallback(async () => {
    const me = await api<Me>('/api/me')
    if (!me.x) return me
    let cap = 0n
    try {
      cap = BigInt(me.x.cap || '0')
    } catch {
      cap = 0n
    }
    applyFlags(!!me.x.followed, !!me.x.retweeted, cap)
    return me
  }, [applyFlags])

  const fetchAlloc = useCallback(async () => {
    if (!cfg) throw new Error('配置未加载')
    await requireTerms()
    const next = await api<Alloc>('/api/allocation', {
      method: 'POST',
      body: JSON.stringify({ acceptTerms: true, termsVersion: cfg.termsVersion }),
    })
    setAlloc(next)
    applyFlags(next.followed, next.retweeted, BigInt(next.cap))
    return next
  }, [cfg, requireTerms, applyFlags])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (!q.has('x') && !q.has('x_error')) return
    const ret = sessionStorage.getItem(OAUTH_RETURN_KEY)
    if (ret?.startsWith('/waitlist')) {
      sessionStorage.removeItem(OAUTH_RETURN_KEY)
      sessionStorage.removeItem(OAUTH_TASK_KEY)
      router.replace(`/waitlist/${window.location.search}`)
    }
  }, [router])

  useEffect(() => {
    loadMe().catch(() => {})
  }, [loadMe])

  useEffect(() => {
    if (!cfg || oauthHandled.current) return
    const q = new URLSearchParams(window.location.search)
    if (q.get('x') !== 'ok' && !q.get('x_error')) return
    if (sessionStorage.getItem(OAUTH_RETURN_KEY)?.startsWith('/waitlist')) return
    oauthHandled.current = true
    const task = sessionStorage.getItem(OAUTH_TASK_KEY)
    sessionStorage.removeItem(OAUTH_TASK_KEY)
    sessionStorage.removeItem(OAUTH_RETURN_KEY)
    if (q.get('x_error')) setError(friendlyError(q.get('x_error')))
    router.replace('/invite/')
    if (q.get('x') === 'ok' && (task === 'follow' || task === 'engage')) {
      setChecking(task)
      fetchAlloc()
        .catch((e) => {
          if (e instanceof ApiError && e.code === 'follow_required') {
            applyFlags(e.body.followed === true, e.body.retweeted === true, 0n)
          }
          setError(friendlyError(e))
        })
        .finally(() => setChecking((current) => (current === task ? null : current)))
    }
  }, [cfg, fetchAlloc, applyFlags, router])

  function startTask(id: TaskId) {
    const url = id === 'follow' ? followUrl : engageUrl
    window.open(url, '_blank', 'noopener,noreferrer')
    setChecking(id)
    setError('')
    void (async () => {
      try {
        if (geo?.blocked) throw new Error('region_restricted')
        await signIn()
        const me = await loadMe()
        if (!me?.x) {
          rememberOauthReturn('/invite', id)
          window.location.href = apiUrl('/api/x/login')
          return
        }
        await fetchAlloc()
      } catch (e) {
        if (e instanceof ApiError && e.code === 'follow_required') {
          applyFlags(e.body.followed === true, e.body.retweeted === true, 0n)
        }
        setError(friendlyError(e))
      } finally {
        setChecking((current) => (current === id ? null : current))
      }
    })()
  }

  async function handleFund(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = parseBem(amount)
    if (windowClosed) return setError('流片窗口已关闭，请重新开启。')
    if (quota === 0) return setError('先完成上面的任务获得额度。')
    if (value == null || value <= 0n) return setError('请输入大于 0 的数量。')
    if (value < MIN_BEM) return setError('单笔最少 0.1 BEM。')
    const capHint = storedCap > 0n ? storedCap : parseUnits(formatBem(quota), 8)
    const room = capHint > contributed ? capHint - contributed : 0n
    if (value > room) return setError(`超出可用额度，最多 ${formatBem(Number(formatUnits(room, 8)))} $BEM。`)

    setPending(true)
    setError('')
    try {
      if (geo?.blocked) throw new Error('region_restricted')
      if (!cfg || !pub) throw new Error('配置未加载')
      await signIn()
      const fresh =
        alloc && BigInt(alloc.deadline) > BigInt(Math.floor(Date.now() / 1000)) + 30n && value <= BigInt(alloc.cap)
          ? alloc
          : await fetchAlloc()
      if (value > BigInt(fresh.cap) - contributed) {
        const left = BigInt(fresh.cap) > contributed ? BigInt(fresh.cap) - contributed : 0n
        throw new Error(`超出可用额度，最多 ${formatBem(Number(formatUnits(left, 8)))} $BEM。`)
      }
      const { account: addr, wallet } = await connect()
      const allowance = await pub.readContract({
        address: cfg.bem,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [addr, cfg.sale],
      })
      if (allowance < value) {
        const hash = await wallet.writeContract({
          address: cfg.bem,
          abi: erc20Abi,
          functionName: 'approve',
          args: [cfg.sale, value],
          account: addr,
          chain: wallet.chain,
        })
        await pub.waitForTransactionReceipt({ hash })
      }
      await send('contribute', [value, referrer, fresh.xIdHash, BigInt(fresh.cap), BigInt(fresh.deadline), fresh.sig])
      setSessionFunded(Number(formatUnits(value, 8)))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="schematic-grid relative flex min-h-dvh flex-col bg-background text-foreground md:h-dvh md:overflow-hidden">
      <SiteHeader />
      <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 items-center px-6 pb-4 pt-20 md:px-10 lg:px-16">
      <div className="flex w-full flex-col gap-3">
        <Link
          href="/"
          className="flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回
        </Link>

        <div className="flex flex-col gap-6 md:flex-row md:items-stretch lg:gap-10">
          <div className="flex md:w-1/2 lg:w-7/12">
            <ArtPanel variant="invite" claimed={fundedLabel !== null} fill />
          </div>

          <section aria-labelledby="quota-title" className="tc-orbit rounded-xl md:w-1/2 md:self-center lg:w-5/12">
            <div className="flex h-full flex-col gap-4 rounded-xl bg-background p-4 lg:p-5">
          <div className="flex flex-col gap-1">
            <h1
              id="quota-title"
              className="text-balance text-2xl font-medium leading-tight tracking-tight text-foreground lg:text-3xl"
            >
              解锁进厂配额
            </h1>
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-pretty text-sm leading-relaxed text-muted-foreground">做任务解锁 $BEM 配额，窗口内锁定份额；越早锁定，流片权重越高。</p>
              <p className="shrink-0 font-mono text-sm text-accent" aria-live="polite">
                {`${formatBem(quota)} / ${formatBem(MAX_QUOTA)} $BEM`}
              </p>
            </div>
            <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              比最后时刻参与多得 +—%
              <span className="ml-1.5 normal-case tracking-normal">链上权重参数尚未公布</span>
            </p>
          </div>

          <ol className="flex flex-col gap-2.5">
            {SOCIAL_TASKS.map(({ id, step, title, reward, action, Icon }) => {
              const isDone = done[id]
              const isChecking = checking === id
              return (
                <li key={id} className={`tc-shine rounded-md ${isDone ? 'tc-shine-done' : ''}`}>
                  <div className="flex items-center gap-3 rounded-md bg-card px-3 py-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground">
                      {isDone ? (
                        <Check className="size-5 text-accent" aria-hidden="true" />
                      ) : (
                        <Icon className="size-4" aria-hidden="true" />
                      )}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{step}</span>
                      <span className="text-pretty font-medium leading-snug text-foreground">{title}</span>
                      <span className="text-sm text-accent">{`+${formatBem(reward)} $BEM Genesis 额度`}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => startTask(id)}
                      disabled={isDone || isChecking || pending}
                      className="flex h-9 shrink-0 items-center gap-1 rounded-sm bg-secondary px-3 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:bg-transparent disabled:text-muted-foreground"
                    >
                      {isDone ? '已完成' : isChecking ? '验证中…' : action}
                      {!isDone && !isChecking && <ArrowUpRight className="size-4" aria-hidden="true" />}
                    </button>
                  </div>
                </li>
              )
            })}

            {quota === 0 && (
              <li className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-5">
                <svg
                  viewBox="0 0 100 80"
                  className="h-10 w-12 text-accent drop-shadow-[0_0_8px_var(--color-accent)]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinejoin="miter"
                  aria-hidden="true"
                >
                  <path d="M6 6 L44 28 L44 52 L6 74 Z" />
                  <path d="M94 6 L56 28 L56 52 L94 74 Z" />
                </svg>
                <span className="text-xs text-muted-foreground">
                  完成任意任务后获得早期流片席位
                </span>
              </li>
            )}

            {error && quota === 0 && (
              <li>
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              </li>
            )}

            {quota > 0 && (
            <li className="tc-shine tc-shine-strong rounded-md animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex flex-col gap-2.5 rounded-md bg-card px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground">
                    {fundedLabel !== null ? (
                      <Check className="size-5 text-accent" aria-hidden="true" />
                    ) : (
                      <Wallet className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-mono text-[10px] tracking-widest text-muted-foreground">TASK.03</span>
                    <span className="font-medium leading-snug text-foreground">用 $BEM 锁定份额</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {account
                        ? `已连接 ${account.slice(0, 6)}…${account.slice(-4)} · 额度内锁定`
                        : '连接钱包后即可锁定'}
                    </span>
                  </div>
                  {fundedLabel === null && (
                    <SubscribeCountdown
                      deadlineMs={deadlineMs}
                      onRestart={() => {
                        setError('')
                        refresh()
                          .then(() => {
                            if (sale && sale.phase !== 1) setError('当前不在流片窗口内。')
                          })
                          .catch((e) => setError(friendlyError(e)))
                      }}
                    />
                  )}
                </div>

                {fundedLabel !== null ? (
                  <p role="status" className="text-sm leading-relaxed text-accent">
                    {`已锁定 ${fundedLabel} $BEM；窗口关闭后按时间权重分币。`}
                  </p>
                ) : (
                  <form onSubmit={handleFund} noValidate className="flex flex-col gap-2">
                    <label htmlFor="bem-amount" className="sr-only">
                      锁定数量
                    </label>
                    <div className="flex gap-2">
                      <div className="flex h-10 min-w-0 flex-1 items-center rounded-sm border border-border bg-background pr-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
                        <input
                          id="bem-amount"
                          inputMode="decimal"
                          autoComplete="off"
                          value={amount}
                          onChange={(e) => {
                            setAmount(e.target.value.replace(/[^0-9.]/g, ''))
                            setError('')
                          }}
                          placeholder={windowClosed ? '流片窗口已关闭' : quota > 0 ? `最多 ${formatBem(quota)}` : '完成任务后解锁'}
                          disabled={locked}
                          aria-invalid={Boolean(error)}
                          aria-describedby={error ? 'fund-error' : undefined}
                          className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground disabled:cursor-not-allowed"
                        />
                        <button
                          type="button"
                          onClick={() => setAmount(formatBem(quota))}
                          disabled={locked}
                          className="font-mono text-xs tracking-widest text-accent disabled:text-muted-foreground"
                        >
                          MAX
                        </button>
                      </div>
                      <button
                        type="submit"
                        disabled={locked || pending}
                        className="flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground disabled:opacity-100 disabled:hover:opacity-100"
                      >
                        {pending ? (account ? '锁定中…' : '连接中…') : account ? '锁定' : '连接并锁定'}
                      </button>
                    </div>
                    {error && (
                      <p id="fund-error" className="text-sm text-destructive">
                        {error}
                      </p>
                    )}
                  </form>
                )}
              </div>
            </li>
            )}
          </ol>
            </div>
          </section>
        </div>
      </div>
      </div>
      <EcosystemMarquee compact />
    </main>
  )
}
