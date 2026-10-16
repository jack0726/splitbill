// EMVCo merchant-presented QR payload for a Singapore PayNow mobile proxy.
function field(id: string, value: string) { return `${id}${new TextEncoder().encode(value).length.toString().padStart(2, '0')}${value}` }

function crc16(value: string) {
  let crc = 0xffff
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
    crc &= 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function payNowPayload(phone: string, name: string, amount: number | null, reference: string) {
  const proxy = field('00', 'SG.PAYNOW') + field('01', '0') + field('02', phone) + field('03', '0')
  const additional = field('01', reference.slice(0, 25))
  const safeName = name.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').slice(0, 25) || 'SplitBill'
  const payload = field('00', '01') + field('01', amount == null ? '11' : '12') + field('26', proxy) + field('52', '0000') + field('53', '702') + (amount == null ? '' : field('54', amount.toFixed(2))) + field('58', 'SG') + field('59', safeName) + field('60', 'Singapore') + field('62', additional) + '6304'
  return payload + crc16(payload)
}
