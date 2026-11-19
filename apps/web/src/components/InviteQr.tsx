import { create } from 'qrcode'
import { useMemo } from 'react'

const QUIET_ZONE = 4

/** The invite link as a QR code: dark modules on white, so it scans in dark mode too. */
export function InviteQr({ text }: { text: string }) {
  const { size, d } = useMemo(() => {
    const { modules } = create(text, { errorCorrectionLevel: 'M' })
    let path = ''
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) if (modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`
    }
    return { size: modules.size, d: path }
  }, [text])
  const box = size + QUIET_ZONE * 2
  return (
    <svg className="qr" viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label="QR code for the invite link">
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={box} height={box} fill="#fff" />
      <path d={d} fill="#3d2c42" />
    </svg>
  )
}
