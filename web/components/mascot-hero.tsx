import Image from 'next/image'

const traits = [
  { label: 'mask', value: 'balaclava.ears' },
  { label: 'shades', value: 'white.wrap' },
  { label: 'claws', value: 'chrome.exo' },
  { label: 'deck', value: 'nand.tiles' },
]

export function MascotHero() {
  return (
    <section className="schematic-grid border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-16 md:flex-row md:items-center md:py-24">
        <div className="flex flex-1 flex-col gap-6">
          <div className="flex items-center gap-2 font-mono text-xs text-primary">
            <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
            {'a0 = 1 · TAPEOUT READY'}
          </div>
          <h1 className="font-sans text-5xl font-bold leading-tight text-balance md:text-7xl">
            TAPECAT
          </h1>
          <p className="max-w-md leading-relaxed text-muted-foreground text-pretty">
            没人见过 TAPECAT 的脸。猫耳头套、白色墨镜、一双铬金属机械爪，它把芯片、晶体管和 NAND 门一张张拍上桌，像排 Tier List 一样给链上项目排位。
          </p>
          <dl className="grid max-w-md grid-cols-2 gap-3">
            {traits.map((t) => (
              <div
                key={t.label}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
              >
                <dt className="text-muted-foreground">{t.label}</dt>
                <dd className="text-primary">{t.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-3">
            <a
              href="/images/tapecat-hero.png"
              download
              className="rounded-md bg-primary px-5 py-2.5 font-mono text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              下载主形象
            </a>
            <a
              href="#gallery"
              className="rounded-md border border-border px-5 py-2.5 font-mono text-sm transition-colors hover:border-primary hover:text-primary"
            >
              查看表情包
            </a>
          </div>
        </div>
        <div className="flex-1">
          <div className="overflow-hidden rounded-xl border border-border shadow-[0_0_80px_-20px_var(--primary)]">
            <Image
              src="/images/tapecat-hero.png"
              alt="TAPECAT 主形象：戴猫耳黑色头套和白色墨镜、长着铬金属机械爪的匿名黑客，把一张 NAND 门卡片放到电路板上，四周漂浮着芯片、晶体管、领结标志和终端图标，两侧电脑屏幕分别显示 TapeOut 标志和领结标志"
              width={1408}
              height={768}
              priority
              className="h-auto w-full"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
