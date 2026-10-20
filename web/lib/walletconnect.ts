import { rethrowWallet, WC_PROJECT_ID, type Eip1193 } from '@/lib/wallets'

type EthereumProvider = InstanceType<(typeof import('@walletconnect/ethereum-provider'))['EthereumProvider']>

const METHODS = [
  'eth_sendTransaction',
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
]

const EVENTS = ['chainChanged', 'accountsChanged']

type Cache = { key: string; provider: EthereumProvider }

let cache: Cache | null = null
let inflight: Promise<EthereumProvider> | null = null

/**
 * WalletConnect is compiled in, but only constructed when a project id was present at build time.
 * Missing `NEXT_PUBLIC_WC_PROJECT_ID` never reaches this module's init path.
 */
export async function loadWalletConnect(opts: { chainId: number; rpcUrl: string }): Promise<EthereumProvider> {
  if (!WC_PROJECT_ID) throw new Error('WalletConnect 未配置')
  if (typeof window === 'undefined') throw new Error('WalletConnect 仅在浏览器中可用')
  const key = `${opts.chainId}:${opts.rpcUrl}`
  if (cache?.key === key) return cache.provider
  if (inflight) return inflight

  inflight = (async () => {
    if (cache && cache.key !== key) {
      await cache.provider.disconnect().catch(() => {})
      cache = null
    }
    const { EthereumProvider } = await import('@walletconnect/ethereum-provider')
    const origin = window.location.origin
    const chains: [number] = [opts.chainId]
    const provider = await EthereumProvider.init({
      projectId: WC_PROJECT_ID,
      chains,
      showQrModal: true,
      methods: METHODS,
      events: EVENTS,
      rpcMap: opts.rpcUrl ? { [String(opts.chainId)]: opts.rpcUrl } : undefined,
      metadata: {
        name: 'tapecat',
        description: 'TAPECAT',
        url: origin,
        icons: [`${origin}/images/tapecat-logo.png`],
      },
      qrModalOptions: {
        themeMode: 'dark',
        themeVariables: {
          '--wcm-accent-color': '#2fbf62',
          '--wcm-background-color': '#23272b',
          '--wcm-accent-fill-color': '#0f1a13',
        },
      },
    })
    cache = { key, provider }
    return provider
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

export function asEip1193(provider: EthereumProvider): Eip1193 {
  return provider as unknown as Eip1193
}

/** Opens the QR modal only when there is no persisted WalletConnect session. */
export async function openWalletConnect(opts: { chainId: number; rpcUrl: string }): Promise<Eip1193> {
  const provider = await loadWalletConnect(opts)
  try {
    if (!provider.session) await provider.connect()
  } catch (error) {
    rethrowWallet(error)
  }
  return asEip1193(provider)
}

export async function silentWalletConnect(opts: { chainId: number; rpcUrl: string }): Promise<Eip1193 | null> {
  if (!WC_PROJECT_ID) return null
  try {
    const provider = await loadWalletConnect(opts)
    if (!provider.session) return null
    return asEip1193(provider)
  } catch {
    return null
  }
}

export async function disconnectWalletConnect() {
  if (!cache) return
  const provider = cache.provider
  try {
    await provider.disconnect()
  } catch {
    // The local selection is already cleared. A failed relay disconnect should not trap the user.
  }
}
