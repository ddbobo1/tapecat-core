/**
 * EIP-6963 discovery plus the optional WalletConnect entry.
 * `NEXT_PUBLIC_WC_PROJECT_ID` is inlined at build time; an empty value hides WalletConnect.
 */

export const WALLET_RDNS_KEY = 'tc_wallet_rdns'
export const BROWSER_RDNS = 'browser-wallet'
export const WC_RDNS = 'io.walletconnect'

export const WC_PROJECT_ID = (process.env.NEXT_PUBLIC_WC_PROJECT_ID || '').trim()

export const walletConnectEnabled = WC_PROJECT_ID.length > 0

export type Eip1193 = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
  off?: (event: string, listener: (...args: unknown[]) => void) => void
  addListener?: (event: string, listener: (...args: unknown[]) => void) => void
}

export type Eip6963Info = {
  uuid: string
  name: string
  icon: string
  rdns: string
}

export type Eip6963Detail = {
  info: Eip6963Info
  provider: Eip1193
}

export type WalletKind = 'eip6963' | 'injected' | 'walletconnect'

export type WalletOption = {
  rdns: string
  name: string
  icon?: string
  kind: WalletKind
  provider?: Eip1193
}

export const INSTALL_WALLETS = [
  { name: 'MetaMask', href: 'https://metamask.io/download/' },
  { name: 'OKX Wallet', href: 'https://www.okx.com/web3' },
  { name: 'Binance Web3 Wallet', href: 'https://www.binance.com/en/web3wallet' },
  { name: 'Rabby', href: 'https://rabby.io/' },
  { name: 'TokenPocket', href: 'https://www.tokenpocket.pro/en/download/pc' },
  { name: 'Bitget Wallet', href: 'https://web3.bitget.com/en/wallet-download' },
] as const

const WC_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#3B99FC"/><path fill="#fff" d="M8.2 13.1c4.3-4.2 11.3-4.2 15.6 0l.5.5c.2.2.2.5 0 .7l-1.7 1.6c-.1.1-.3.1-.4 0l-.7-.7c-3-2.9-7.8-2.9-10.8 0l-.8.7c-.1.1-.3.1-.4 0l-1.7-1.6c-.2-.2-.2-.5 0-.7l.4-.5zm16.9 3.1 1.5 1.5c.2.2.2.5 0 .7l-6.8 6.6c-.2.2-.6.2-.8 0l-4.8-4.7c-.1-.1-.2-.1-.3 0l-4.8 4.7c-.2.2-.6.2-.8 0L7.5 18.4c-.2-.2-.2-.5 0-.7l1.5-1.5c.2-.2.6-.2.8 0l4.8 4.7c.1.1.2.1.3 0l4.8-4.7c.2-.2.6-.2.8 0l4.8 4.7c.1.1.2.1.3 0l4.8-4.7c.2-.2.5-.2.7 0z"/></svg>',
  )

export function safeIcon(icon: string | undefined): string | undefined {
  if (!icon) return undefined
  const value = icon.trim()
  if (value.startsWith('data:image/') || value.startsWith('https://')) return value
  return undefined
}

export function injectedProvider(): Eip1193 | undefined {
  if (typeof window === 'undefined') return undefined
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum
  if (!eth?.request) return undefined
  return eth
}

export function readStoredRdns(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = localStorage.getItem(WALLET_RDNS_KEY)
    return value && value.trim() ? value : null
  } catch {
    return null
  }
}

export function writeStoredRdns(rdns: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (rdns) localStorage.setItem(WALLET_RDNS_KEY, rdns)
    else localStorage.removeItem(WALLET_RDNS_KEY)
  } catch {
    // Private mode and locked-down browsers can reject storage. The session still works.
  }
}

export function buildWalletOptions(input: {
  announced: Eip6963Detail[]
  injected?: Eip1193
  settled: boolean
  includeWalletConnect: boolean
}): WalletOption[] {
  const options: WalletOption[] = []
  const seen = new Set<string>()
  for (const detail of input.announced) {
    const rdns = detail?.info?.rdns
    if (!rdns || seen.has(rdns) || !detail.provider?.request) continue
    seen.add(rdns)
    options.push({
      rdns,
      name: detail.info.name?.trim() || rdns,
      icon: safeIcon(detail.info.icon),
      kind: 'eip6963',
      provider: detail.provider,
    })
  }
  if (options.length === 0 && input.settled && input.injected) {
    options.push({
      rdns: BROWSER_RDNS,
      name: 'Browser wallet',
      kind: 'injected',
      provider: input.injected,
    })
  }
  if (input.includeWalletConnect) {
    options.push({
      rdns: WC_RDNS,
      name: 'WalletConnect',
      icon: WC_ICON,
      kind: 'walletconnect',
    })
  }
  return options
}

export function subscribeEip6963(onUpdate: (providers: Eip6963Detail[]) => void): () => void {
  const map = new Map<string, Eip6963Detail>()
  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail
    if (!detail?.info?.rdns || !detail.provider?.request) return
    map.set(detail.info.rdns, detail)
    onUpdate([...map.values()])
  }
  window.addEventListener('eip6963:announceProvider', onAnnounce)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  return () => window.removeEventListener('eip6963:announceProvider', onAnnounce)
}

export function rejectedError() {
  return new Error('User rejected')
}

export function rethrowWallet(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (/user rejected|user denied|denied|connection request reset|closed modal|cancelled|canceled/i.test(message)) {
    throw rejectedError()
  }
  throw error instanceof Error ? error : new Error(message)
}
