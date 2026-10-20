'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  isAddress,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { chainOf, saleAbi, ZERO, type SiteConfig } from '@/lib/chain'
import { RiskDisclosure } from '@/components/risk-disclosure'
import { apiUrl } from '@/lib/api-base'

import { WalletPicker } from '@/components/wallet-picker'
import { disconnectWalletConnect, openWalletConnect, silentWalletConnect } from '@/lib/walletconnect'
import {
  BROWSER_RDNS,
  buildWalletOptions,
  injectedProvider,
  readStoredRdns,
  rejectedError,
  subscribeEip6963,
  walletConnectEnabled,
  WC_RDNS,
  writeStoredRdns,
  type Eip1193,
  type Eip6963Detail,
  type WalletOption,
} from '@/lib/wallets'

export type SaleState = {
  phase: number
  start: bigint
  endTime: bigint
  totalRaised: bigint
  contributed: bigint
  claimableRebate: bigint
  claimableTokens: bigint
  claimed: boolean
  referrerOf: Address
}

type Ctx = {
  cfg: SiteConfig | null
  configError: string | null
  geo: { blocked: boolean; country: string | null } | null
  account: Address | null
  pub: PublicClient | null
  sale: SaleState | null
  referrer: Address
  connect: (opts?: { choose?: boolean }) => Promise<{ account: Address; wallet: WalletClient }>
  disconnect: () => Promise<void>
  signIn: () => Promise<Address>
  requireTerms: () => Promise<void>
  send: (fn: string, args?: readonly unknown[]) => Promise<void>
  refresh: () => Promise<void>
}

const SiteCtx = createContext<Ctx | null>(null)

export const useSite = () => {
  const c = useContext(SiteCtx)
  if (!c) throw new Error('useSite outside SiteProvider')
  return c
}

export class ApiError extends Error {
  code: string
  retryAfter?: number
  body: Record<string, unknown>
  constructor(code: string, body: Record<string, unknown> = {}, retryAfter?: number) {
    super(code)
    this.name = 'ApiError'
    this.code = code
    this.body = body
    this.retryAfter = retryAfter
  }
}

export async function api<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const code = typeof j.error === 'string' && j.error ? j.error : res.statusText
    const headerRetry = Number(res.headers.get('retry-after'))
    const bodyRetry = Number(j.retryAfter)
    const retryAfter =
      Number.isFinite(bodyRetry) && bodyRetry > 0
        ? bodyRetry
        : Number.isFinite(headerRetry) && headerRetry > 0
          ? headerRetry
          : undefined
    throw new ApiError(code, j, retryAfter)
  }
  return j as T
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function readAddress(accounts: unknown): Address | null {
  const list = Array.isArray(accounts) ? accounts : []
  const first = list[0]
  if (typeof first !== 'string' || !isAddress(first)) return null
  return getAddress(first)
}

function bindProvider(provider: Eip1193, onAccounts: (accounts: unknown) => void, onChain: () => void, onDisconnect: () => void) {
  const add = provider.on?.bind(provider) ?? provider.addListener?.bind(provider)
  add?.('accountsChanged', onAccounts)
  add?.('chainChanged', onChain)
  add?.('disconnect', onDisconnect)
  return () => {
    const remove = provider.removeListener?.bind(provider) ?? provider.off?.bind(provider)
    remove?.('accountsChanged', onAccounts)
    remove?.('chainChanged', onChain)
    remove?.('disconnect', onDisconnect)
  }
}

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const [cfg, setCfg] = useState<SiteConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [geo, setGeo] = useState<Ctx['geo']>(null)
  const [account, setAccount] = useState<Address | null>(null)
  const [sale, setSale] = useState<SaleState | null>(null)
  const [referrer, setReferrer] = useState<Address>(ZERO)
  const [termsOpen, setTermsOpen] = useState(false)
  const [termsChecked, setTermsChecked] = useState(false)
  const [announced, setAnnounced] = useState<Eip6963Detail[]>([])
  const [injected, setInjected] = useState<Eip1193 | undefined>(undefined)
  const [discoverySettled, setDiscoverySettled] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeRdns, setActiveRdns] = useState<string | null>(null)
  const termsResolve = useRef<(() => void) | null>(null)
  const termsReject = useRef<((reason: Error) => void) | null>(null)
  const pickWait = useRef<{ resolve: (option: WalletOption) => void; reject: (reason: Error) => void } | null>(null)
  const selectedRef = useRef<Eip1193 | null>(null)
  const rdnsRef = useRef<string | null>(null)
  const sessionRef = useRef(0)
  const unlistenRef = useRef<(() => void) | null>(null)
  const announcedRef = useRef<Eip6963Detail[]>([])
  const cfgRef = useRef<SiteConfig | null>(null)
  announcedRef.current = announced
  cfgRef.current = cfg

  const unlisten = useCallback(() => {
    unlistenRef.current?.()
    unlistenRef.current = null
  }, [])

  const listen = useCallback(
    (provider: Eip1193, rdns: string) => {
      unlisten()
      const onAccounts = (accounts: unknown) => {
        if (rdnsRef.current !== rdns) return
        setAccount(readAddress(accounts))
      }
      const onChain = () => {
        if (rdnsRef.current !== rdns) return
        provider.request({ method: 'eth_accounts' }).then(onAccounts).catch(() => {})
      }
      const onDisconnect = () => {
        if (rdnsRef.current !== rdns) return
        setAccount(null)
        if (rdns === WC_RDNS) selectedRef.current = null
      }
      unlistenRef.current = bindProvider(provider, onAccounts, onChain, onDisconnect)
    },
    [unlisten],
  )

  const commitProvider = useCallback(
    (provider: Eip1193, rdns: string) => {
      selectedRef.current = provider
      rdnsRef.current = rdns
      setActiveRdns(rdns)
      writeStoredRdns(rdns)
      listen(provider, rdns)
    },
    [listen],
  )

  useEffect(() => {
    api<SiteConfig>('/api/config').then(setCfg).catch((e) => setConfigError(String(e.message || e)))
    api<{ blocked: boolean; country: string | null }>('/api/geo').then(setGeo).catch(() => setGeo(null))

    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref && isAddress(ref)) localStorage.setItem('tc_ref', getAddress(ref))
    const stored = localStorage.getItem('tc_ref')
    if (stored && isAddress(stored)) setReferrer(getAddress(stored))

    setInjected(injectedProvider())
    const stop = subscribeEip6963(setAnnounced)
    const timer = window.setTimeout(() => setDiscoverySettled(true), 400)
    return () => {
      stop()
      window.clearTimeout(timer)
    }
  }, [])

  const chain = useMemo(() => (cfg ? chainOf(cfg.chainId) : null), [cfg])
  const pub = useMemo(
    () => (cfg && chain ? (createPublicClient({ chain, transport: http(cfg.rpcUrl) }) as PublicClient) : null),
    [cfg, chain],
  )

  const termsKey = cfg ? `tc_terms_${cfg.termsVersion}` : 'tc_terms'
  const requireTerms = useCallback(() => {
    if (localStorage.getItem(termsKey) === '1') return Promise.resolve()
    setTermsChecked(false)
    setTermsOpen(true)
    return new Promise<void>((resolve, reject) => {
      termsResolve.current = resolve
      termsReject.current = reject
    })
  }, [termsKey])

  const settleTerms = useCallback(
    (accepted: boolean) => {
      setTermsOpen(false)
      if (accepted) {
        localStorage.setItem(termsKey, '1')
        termsResolve.current?.()
      } else {
        termsReject.current?.(new Error('未同意风险披露'))
      }
      termsResolve.current = null
      termsReject.current = null
    },
    [termsKey],
  )

  const closePicker = useCallback(() => {
    setPickerOpen(false)
    const pending = pickWait.current
    pickWait.current = null
    pending?.reject(rejectedError())
  }, [])

  const selectOption = useCallback((option: WalletOption) => {
    setPickerOpen(false)
    const pending = pickWait.current
    pickWait.current = null
    pending?.resolve(option)
  }, [])

  const pickWallet = useCallback(() => {
    if (pickWait.current) {
      return new Promise<WalletOption>((resolve, reject) => {
        const previous = pickWait.current!
        pickWait.current = {
          resolve: (option) => {
            previous.resolve(option)
            resolve(option)
          },
          reject: (reason) => {
            previous.reject(reason)
            reject(reason)
          },
        }
      })
    }
    setPickerOpen(true)
    return new Promise<WalletOption>((resolve, reject) => {
      pickWait.current = { resolve, reject }
    })
  }, [])

  const providerForRdns = useCallback(async (rdns: string): Promise<Eip1193 | null> => {
    if (rdns === WC_RDNS) {
      const start = Date.now()
      while (!cfgRef.current && Date.now() - start < 3000) await wait(50)
      const current = cfgRef.current
      if (!current || !walletConnectEnabled) return null
      return silentWalletConnect({ chainId: current.chainId, rpcUrl: current.rpcUrl })
    }
    if (rdns === BROWSER_RDNS) return injectedProvider() ?? null
    const immediate = announcedRef.current.find((detail) => detail.info.rdns === rdns)?.provider
    if (immediate) return immediate
    const start = Date.now()
    while (Date.now() - start < 800) {
      await wait(50)
      const found = announcedRef.current.find((detail) => detail.info.rdns === rdns)?.provider
      if (found) return found
    }
    return null
  }, [])

  const restoreStored = useCallback(async (): Promise<Eip1193 | null> => {
    if (selectedRef.current) return selectedRef.current
    const session = sessionRef.current
    const rdns = readStoredRdns()
    if (!rdns) return null
    const provider = await providerForRdns(rdns)
    if (sessionRef.current !== session) return selectedRef.current
    if (selectedRef.current) return selectedRef.current
    if (!provider) return null
    commitProvider(provider, rdns)
    return provider
  }, [commitProvider, providerForRdns])

  useEffect(() => {
    let cancel = false
    const session = sessionRef.current
    restoreStored()
      .then(async (provider) => {
        if (cancel || sessionRef.current !== session || !provider) return
        const accounts = await provider.request({ method: 'eth_accounts' }).catch(() => null)
        if (cancel || sessionRef.current !== session || !accounts) return
        const addr = readAddress(accounts)
        if (addr) setAccount(addr)
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [cfg, announced, restoreStored])

  const chooseProvider = useCallback(async () => {
    const option = await pickWallet()
    const start = Date.now()
    while (!cfgRef.current && Date.now() - start < 3000) await wait(50)
    const current = cfgRef.current
    if (!current) throw new Error('配置未加载')
    const provider =
      option.kind === 'walletconnect'
        ? await openWalletConnect({ chainId: current.chainId, rpcUrl: current.rpcUrl })
        : option.provider
    if (!provider) throw new Error('钱包不可用')
    if (rdnsRef.current === WC_RDNS && option.rdns !== WC_RDNS) {
      unlisten()
      await disconnectWalletConnect()
    }
    commitProvider(provider, option.rdns)
    return provider
  }, [commitProvider, pickWallet, unlisten])

  const connect = useCallback(
    async (opts?: { choose?: boolean }) => {
      const provider = opts?.choose ? await chooseProvider() : (await restoreStored()) ?? (await chooseProvider())
      const current = cfgRef.current
      const activeChain = current ? chainOf(current.chainId) : chain
      if (!activeChain) throw new Error('配置未加载')
      await requireTerms()
      const accounts = await provider.request({ method: 'eth_requestAccounts' })
      const addr = readAddress(accounts)
      if (!addr) throw new Error('未检测到钱包账户')
      setAccount(addr)
      const wallet = createWalletClient({ account: addr, chain: activeChain, transport: custom(provider) })
      if ((await wallet.getChainId()) !== activeChain.id) {
        try {
          await wallet.switchChain({ id: activeChain.id })
        } catch {
          await wallet.addChain({ chain: activeChain })
        }
      }
      return { account: addr, wallet }
    },
    [chain, chooseProvider, requireTerms, restoreStored],
  )

  const disconnect = useCallback(async () => {
    const rdns = rdnsRef.current
    sessionRef.current += 1
    unlisten()
    selectedRef.current = null
    rdnsRef.current = null
    setActiveRdns(null)
    setAccount(null)
    writeStoredRdns(null)
    if (rdns === WC_RDNS) await disconnectWalletConnect()
    await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {})
  }, [unlisten])

  const refresh = useCallback(async () => {
    if (!pub || !cfg || cfg.sale === ZERO) return
    const c = { address: cfg.sale, abi: saleAbi } as const
    const [phase, start, endTime, totalRaised] = await Promise.all([
      pub.readContract({ ...c, functionName: 'phase' }),
      pub.readContract({ ...c, functionName: 'start' }),
      pub.readContract({ ...c, functionName: 'endTime' }),
      pub.readContract({ ...c, functionName: 'totalRaised' }),
    ])
    let mine = { contributed: 0n, claimableRebate: 0n, claimableTokens: 0n, claimed: false, referrerOf: ZERO }
    if (account) {
      const [contributed, claimableRebate, claimableTokens, claimed, referrerOf] = await Promise.all([
        pub.readContract({ ...c, functionName: 'contributed', args: [account] }),
        pub.readContract({ ...c, functionName: 'claimableRebate', args: [account] }),
        pub.readContract({ ...c, functionName: 'claimableTokens', args: [account] }),
        pub.readContract({ ...c, functionName: 'claimed', args: [account] }),
        pub.readContract({ ...c, functionName: 'referrerOf', args: [account] }),
      ])
      mine = { contributed, claimableRebate, claimableTokens, claimed, referrerOf }
    }
    setSale({ phase, start, endTime, totalRaised, ...mine })
  }, [pub, cfg, account])

  useEffect(() => {
    refresh().catch(() => {})
    const t = setInterval(() => refresh().catch(() => {}), 15_000)
    return () => clearInterval(t)
  }, [refresh])

  const signIn = useCallback(async () => {
    const { account: addr, wallet } = await connect()
    const me = await api<{ wallet: string | null }>('/api/me')
    if (me.wallet && me.wallet.toLowerCase() === addr.toLowerCase()) return addr
    const n = await api<{ nonce: string; domain: string; uri: string; chainId: number }>('/api/siwe/nonce')
    const message = createSiweMessage({
      address: addr,
      chainId: n.chainId,
      domain: n.domain,
      nonce: n.nonce,
      uri: n.uri,
      version: '1',
      statement: 'Sign in to tapecat. This does not cost gas.',
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 10 * 60 * 1000),
    })
    const signature = await wallet.signMessage({ account: addr, message })
    await api('/api/siwe/verify', { method: 'POST', body: JSON.stringify({ message, signature }) })
    return addr
  }, [connect])

  const send = useCallback(
    async (fn: string, args: readonly unknown[] = []) => {
      if (!pub || !cfg) throw new Error('配置未加载')
      const { account: from, wallet } = await connect()
      const { request } = await pub.simulateContract({
        account: from,
        address: cfg.sale,
        abi: saleAbi,
        functionName: fn as never,
        args: args as never,
      })
      const hash = await wallet.writeContract(request as never)
      await pub.waitForTransactionReceipt({ hash })
      await refresh()
    },
    [pub, cfg, connect, refresh],
  )

  const walletOptions = useMemo(
    () =>
      buildWalletOptions({
        announced,
        injected,
        settled: discoverySettled,
        includeWalletConnect: walletConnectEnabled,
      }),
    [announced, injected, discoverySettled],
  )

  const value: Ctx = {
    cfg,
    configError,
    geo,
    account,
    pub,
    sale,
    referrer,
    connect,
    disconnect,
    signIn,
    requireTerms,
    send,
    refresh,
  }

  return (
    <SiteCtx.Provider value={value}>
      {children}
      <WalletPicker
        open={pickerOpen}
        options={walletOptions}
        checking={!discoverySettled}
        activeRdns={activeRdns}
        onSelect={selectOption}
        onClose={closePicker}
      />
      {termsOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="terms-title">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-xl border border-border bg-card p-6">
            <h2 id="terms-title" className="text-xl font-semibold">
              参与前请阅读风险披露
            </h2>
            <div className="overflow-y-auto pr-2">
              <RiskDisclosure compact />
            </div>
            <label className="flex items-start gap-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[var(--accent)]"
                checked={termsChecked}
                onChange={(e) => setTermsChecked(e.target.checked)}
              />
              我确认不属于中国大陆、美国或受 OFAC 制裁地区的居民或实体，并已阅读和理解上述风险披露。
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => settleTerms(false)}
                className="h-11 rounded-lg border border-border px-5 text-sm text-muted-foreground hover:text-foreground"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!termsChecked}
                onClick={() => settleTerms(true)}
                className="h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-foreground disabled:opacity-40"
              >
                同意并继续
              </button>
            </div>
          </div>
        </div>
      )}
    </SiteCtx.Provider>
  )
}
