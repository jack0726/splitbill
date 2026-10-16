import { useEffect, useState } from 'react'
import * as QRCode from 'qrcode'
import type { Profile } from '../lib/supabase'
import { payNowPayload } from '../lib/paynow'

export default function PayNowDialog({ recipient, amount, currency, onPaid, onCancel }: {
  recipient: Profile; amount: number; currency: string; onPaid: () => void; onCancel: () => void
}) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    if (!recipient.paynow_mobile) return
    QRCode.toDataURL(payNowPayload(recipient.paynow_mobile, recipient.name, currency === 'SGD' ? amount : null, 'SplitBill'), { width: 256, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => { if (live) setSrc(url) }, () => { if (live) setError('Could not create the PayNow QR.') })
    return () => { live = false }
  }, [recipient, amount, currency])

  return <div className="modal" onClick={onCancel}>
    <div className="card sheet paynowDialog" onClick={(e) => e.stopPropagation()}>
      <h3>Pay {recipient.name}</h3>
      <p>Scan this Singapore PayNow QR in your banking app to pay <b>{amount.toFixed(2)} {currency}</b>.</p>
      {recipient.paynow_mobile && src && <img className="paynowQr" src={src} alt={`PayNow QR for ${recipient.name}`} />}
      {recipient.paynow_mobile && error && <p className="error">{error}</p>}
      {!recipient.paynow_mobile && <p className="muted">{recipient.name} has not added a PayNow mobile number. Arrange payment with them directly, then record it here.</p>}
      {currency !== 'SGD' && recipient.paynow_mobile && <p className="muted small">This QR accepts SGD and does not prefill an amount. This group uses {currency}, so convert and check the amount in your banking app before paying.</p>}
      {recipient.paynow_mobile && <p className="muted small">PayNow mobile: {recipient.paynow_mobile}</p>}
      <div className="row"><button type="button" onClick={onPaid}>I’ve paid</button><button type="button" className="link" onClick={onCancel}>Cancel</button></div>
    </div>
  </div>
}
