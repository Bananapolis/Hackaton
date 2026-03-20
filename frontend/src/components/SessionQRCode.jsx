import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function SessionQRCode({ value, size = 420, className = '' }) {
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    let cancelled = false

    if (!value) {
      setQrDataUrl('')
      return
    }

    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl('')
        }
      })

    return () => {
      cancelled = true
    }
  }, [size, value])

  if (!value || !qrDataUrl) return null

  return <img src={qrDataUrl} alt="Session join QR code" className={className} />
}
