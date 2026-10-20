const ZH = [
  ['交易税', 'tapecat 与官方流动性池之间的每笔买入和卖出收取 1% 交易税，税率写死在合约中、不可修改；税款以 tapecat 形式转入项目公布的税收地址，该地址可由项目多签更换。'],
  ['定价规则不是收益承诺', '开盘价按"参与者平均成本的 2 倍"设定，仅为初始定价规则。开盘后价格完全由市场决定，可能迅速下跌至远低于你的成本，你可能损失全部投入。'],
  ['资金用途', '窗口内锁定的 BEM，80% 用于建立流动性（LP 永久锁定），10% 进入项目基金多签，10% 用于邀请返佣。'],
  ['退款', '锁定总额低于 300 BEM 时，任何人可调用 refund 全额退回自己的 BEM。若换币窗口结束后 7 天仍未开盘，按合约内 BEM 与 WBNB 余额比例退款。误转入合约的资产无法取回。'],
  ['无归属、无保护', '所有代币上线即可自由交易，可能出现集中抛售与机器人抢跑。'],
  ['中心化环节', '任务验证与额度签名由项目服务器完成；项目多签可更换签名者、官方邀请人、基金地址（上线前）、税收地址，以及聚合器换币的 Keeper 白名单，但不能修改税率、增发或动用流动性。直连换币与开盘仍对任何人开放。'],
  ['其他风险', '智能合约漏洞、BEM 价格波动、监管变化等。'],
  ['地区限制', '本活动不向中国大陆、美国及受制裁地区的人士提供。'],
  ['', '以上内容不构成投资建议。请自行研究（DYOR），只投入你能承受全部损失的资金。'],
]

const EN = [
  ['Transaction tax', 'every buy and sell between tapecat and the official liquidity pairs carries a 1% tax. The rate is hard-coded and cannot be changed. Tax is paid in tapecat to a published tax-receiver address, which the project multisig may change.'],
  ['Pricing rule, not a return promise', "the opening price is set at 2× the participants' average cost purely as an initial pricing rule. After launch the price is set by the market and may fall far below your cost; you may lose everything."],
  ['Use of funds', '80% of the BEM locked in the window goes to liquidity (LP permanently locked), 10% to the project fund multisig, 10% to referral rebates.'],
  ['Refunds', 'below 300 BEM locked, anyone can call refund() for a full BEM refund. If not launched 7 days after the swap window, refunds are pro rata to the BEM and WBNB held. Assets sent to the contract by mistake cannot be recovered.'],
  ['No vesting, no protections', 'all tokens are freely tradable at launch; concentrated selling and bot front-running may occur.'],
  ['Centralized components', 'task verification and allocation signing are done by a project server. The project multisig can change the signer, official referrer, fund address (before launch), tax receiver, and the keeper whitelist for aggregator swaps, but cannot change the tax rate, mint tokens or touch liquidity. Direct swaps and launch remain permissionless.'],
  ['Other risks', 'smart-contract bugs, BEM price volatility, regulatory changes.'],
  ['Restricted regions', 'not offered to persons in mainland China, the United States or sanctioned jurisdictions.'],
  ['', 'Nothing here is investment advice. DYOR and only commit funds you can afford to lose entirely.'],
]

function List({ items, sep = '：' }: { items: string[][]; sep?: string }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
      {items.map(([title, body]) => (
        <li key={body}>
          {title && (
            <b className="text-foreground">
              {title}
              {sep}
            </b>
          )}
          {body}
        </li>
      ))}
    </ol>
  )
}

export function RiskDisclosure({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {!compact && <h2 className="text-lg font-semibold text-foreground">风险披露</h2>}
        <p className="text-sm leading-relaxed text-muted-foreground">
          tapecat 没有实际用途、不承诺任何价值或收益。在此锁定 $BEM 不会烧掉晶体管，也不会替你完成一次真实流片。参与即表示你理解并接受以下事项：
        </p>
        <List items={ZH} />
      </div>
      <details className="rounded-lg border border-border p-3" open={!compact}>
        <summary className="cursor-pointer text-sm font-medium text-foreground">Risk Disclosure (English)</summary>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          tapecat is a meme token with no utility and no promise of value or returns. By participating you acknowledge:
        </p>
        <div className="mt-2">
          <List items={EN} sep=": " />
        </div>
      </details>
    </div>
  )
}
