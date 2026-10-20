import Image from 'next/image'

const assets = [
  {
    src: '/images/tapecat-schematic.png',
    title: '电路画布版',
    note: '浅色点阵画布 + NAND 门，适合头像 / PFP',
    width: 1024,
    height: 1024,
    alt: '黑白版画风 TAPECAT 头像：猫耳头套、白色墨镜，铬金属爪夹着一枚芯片，背景是点阵电路画布',
    span: '',
  },
  {
    src: '/images/tapecat-stickers.png',
    title: '表情包贴纸',
    note: 'SHIP IT · REKT · HODL · TO THE MOON',
    width: 1376,
    height: 768,
    alt: '匿名黑客 TAPECAT 四个表情贴纸：SHIP IT、REKT、HODL、TO THE MOON',
    span: 'md:col-span-2',
  },
]

export function MascotGallery() {
  return (
    <section id="gallery" className="mx-auto max-w-6xl px-6 py-16">
      <div className="mb-8 flex items-end justify-between gap-4">
        <h2 className="font-sans text-3xl font-bold">形象素材</h2>
        <span className="font-mono text-xs text-muted-foreground">{'out[0..2]'}</span>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {assets.map((a) => (
          <figure
            key={a.src}
            className={`flex flex-col overflow-hidden rounded-xl border border-border bg-card ${a.span}`}
          >
            <Image src={a.src} alt={a.alt} width={a.width} height={a.height} className="h-full w-full object-cover" />
            <figcaption className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
              <div className="flex flex-col">
                <span className="font-medium">{a.title}</span>
                <span className="font-mono text-xs text-muted-foreground">{a.note}</span>
              </div>
              <a
                href={a.src}
                download
                className="shrink-0 rounded-md border border-border px-3 py-1.5 font-mono text-xs transition-colors hover:border-primary hover:text-primary"
              >
                下载
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
