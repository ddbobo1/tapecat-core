const VIDEO_SRC = '/images/tapecat-desk.mp4'
const POSTER_SRC = '/images/tapecat-desk-dark.jpg'

type AnimatedArtProps = {
  grayscale?: boolean
  intense?: boolean
}

export function AnimatedArt({ grayscale = false, intense = false }: AnimatedArtProps) {
  return (
    <div className="tc-anim absolute inset-0">
      <video
        src={VIDEO_SRC}
        poster={POSTER_SRC}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-label="TapeCat 动画：戴猫耳头套和墨镜的角色，用机械手在电路板上制作发绿光的 NAND 芯片"
        className={grayscale ? 'absolute inset-0 size-full object-cover grayscale' : 'absolute inset-0 size-full object-cover'}
      />
      {intense && (
        <span
          aria-hidden="true"
          className="tc-chip-glow absolute rounded-full"
          style={{ left: '50.5%', top: '84%', width: 120, height: 120 }}
        />
      )}
    </div>
  )
}
