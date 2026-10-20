import { formatUnits, parseAbi, type Address, type Chain } from 'viem'
import { bsc, bscTestnet, hardhat } from 'viem/chains'

export type SiteConfig = {
  chainId: number
  rpcUrl: string
  sale: Address
  bem: Address
  token: Address
  xHandle: string
  campaignTweetId: string
  termsVersion: string
}

export const chainOf = (id: number): Chain => ({ 56: bsc, 97: bscTestnet, 31337: hardhat } as Record<number, Chain>)[id] ?? bsc

export const ZERO = '0x0000000000000000000000000000000000000000' as Address
export const TP = 600_000_000n * 10n ** 18n
export const WINDOW = 3600n
export const SAFETY = 7n * 86400n

export const saleAbi = parseAbi([
  'function phase() view returns (uint8)',
  'function start() view returns (uint256)',
  'function endTime() view returns (uint256)',
  'function totalRaised() view returns (uint256)',
  'function bemSold() view returns (uint256)',
  'function wbnbReceived() view returns (uint256)',
  'function batchesDone() view returns (uint256)',
  'function contributed(address) view returns (uint256)',
  'function claimableRebate(address) view returns (uint256)',
  'function claimableTokens(address) view returns (uint256)',
  'function claimed(address) view returns (bool)',
  'function referrerOf(address) view returns (address)',
  'function contribute(uint256 amount, address referrer, bytes32 xIdHash, uint256 cap, uint256 deadline, bytes sig)',
  'function swapBatch(uint256 amount, uint8 route, bytes data)',
  'function launch()',
  'function claim()',
  'function claimRebate()',
  'function refund()',
  'error Closed()',
  'error BadAllocation()',
  'error BadSignature()',
  'error XBound()',
  'error CapExceeded()',
  'error TooSmall()',
  'error BelowMinRaise()',
  'error NotInWindow()',
  'error Cooldown()',
  'error BatchesDone()',
  'error BadAmount()',
  'error NoQuote()',
  'error Slippage()',
  'error BadState()',
  'error NotKeeper()',
  'error NotYet()',
  'error NothingToClaim()',
  'error NotParticipant()',
  'error NoRefund()',
])

export const erc20Abi = parseAbi([
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])

export const PHASES = ['未开始', '流片窗口', '换币窗口（1 小时）', '可开盘', '已上线', '未达最低额 300 BEM · 可退款', '超时未上线 · 可退款']

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function fmtBem(v: bigint, digits = 4) {
  return `${Number(formatUnits(v, 8)).toLocaleString('zh-CN', { maximumFractionDigits: digits })} BEM`
}

export function fmtTok(v: bigint) {
  return Number(formatUnits(v, 18)).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

const ERRORS: Record<string, string> = {
  // verifier
  region_restricted: '你所在的地区不在本活动范围内。',
  sign_in_first: '请先连接钱包并签名登录。',
  connect_x_first: '请先绑定 X 账号。',
  accept_terms: '请先阅读并同意风险披露。',
  follow_required: '还没检测到你关注了项目账号。关注后约 30 秒再试（结果会短暂缓存）。',
  x_account_bound_to_other_wallet: '这个 X 账号已经绑定了另一个钱包。',
  wallet_bound_to_other_x_account: '这个钱包已经绑定了另一个 X 账号。',
  binding_mismatch: 'X 账号与钱包绑定不一致，请重新登录。',
  sale_ended: '流片窗口已结束。',
  x_rate_limited: 'X 接口繁忙，请稍后再试。',
  rate_limited: '请求过于频繁，请稍等一分钟再试。',
  bad_state: 'X 授权已过期，请重新绑定。',
  bad_signature: '签名校验失败，请重试。',
  // contract
  Closed: '当前不在流片窗口内。',
  BadAllocation: '额度签名已过期，请重新获取额度。',
  BadSignature: '额度签名无效，请重新获取额度。',
  XBound: '这个 X 账号或钱包已在链上绑定了其他对象。',
  CapExceeded: '超出你的额度上限。',
  TooSmall: '单笔最少 0.1 BEM。',
  NotInWindow: '不在换币窗口内。',
  Cooldown: '两批换币之间需间隔 5 分钟。',
  NoQuote: '参考池报价不可用（价格偏离 TWAP），稍后再试。',
  Slippage: '超出 2% 滑点保护，本批未执行。',
  NotYet: '时间未到。',
  NothingToClaim: '没有可领取的数额。',
  NotParticipant: '个人邀请人须自己锁定份额才能领取返佣。',
  NoRefund: '当前不满足退款条件。',
  BadState: '当前状态不允许此操作。',
  NotKeeper: '聚合器换币仅限白名单 Keeper；请改用直连路由或等待 Keeper。',
}

/** User-facing text for verifier and contract failures, including `rate_limited`. */
export function friendlyError(e: unknown): string {
  const retryAfter =
    e && typeof e === 'object' && 'retryAfter' in e ? Number((e as { retryAfter?: number }).retryAfter) : NaN
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : ''
  if ((code === 'rate_limited' || code === 'x_rate_limited') && Number.isFinite(retryAfter) && retryAfter > 0) {
    const seconds = Math.ceil(retryAfter)
    return code === 'x_rate_limited'
      ? `X 接口繁忙，请约 ${seconds} 秒后再试。`
      : `请求过于频繁，请约 ${seconds} 秒后再试。`
  }
  return explain(e)
}

export function explain(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; data?: { errorName?: string }; cause?: { data?: { errorName?: string } } }
  const name = err?.cause?.data?.errorName || err?.data?.errorName
  if (name && ERRORS[name]) return ERRORS[name]
  const msg = err?.shortMessage || err?.message || String(e)
  if (ERRORS[msg]) return ERRORS[msg]
  for (const [k, v] of Object.entries(ERRORS)) if (msg.includes(k)) return v
  if (/user rejected|denied/i.test(msg)) return '你取消了操作。'
  return msg
}
