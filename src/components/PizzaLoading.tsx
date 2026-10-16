export default function PizzaLoading({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'pizzaLoading pizzaLogo' : 'pizzaLoading'} role={compact ? undefined : 'status'} aria-label="Pizza">
      <div className="pizzaStage" aria-hidden="true">
        <svg viewBox="0 0 320 360" xmlns="http://www.w3.org/2000/svg">
          <g className="pizzaWhole">
            <path d="M160 40 L280 300 Q160 330 40 300 Z" fill="#E8A03A" stroke="#7A4A16" strokeWidth="5" strokeLinejoin="round" />
            <path d="M160 58 L262 288 Q160 310 58 288 Z" fill="#FFD84D" />
            <circle cx="160" cy="110" r="18" fill="#D9482B" />
            <circle cx="130" cy="200" r="16" fill="#D9482B" />
            <circle cx="192" cy="200" r="16" fill="#D9482B" />
            <circle cx="160" cy="265" r="15" fill="#D9482B" />
            <circle cx="140" cy="155" r="5" fill="#3B2A1A" />
            <circle cx="180" cy="155" r="5" fill="#3B2A1A" />
            <path d="M145 178 Q160 192 175 178" fill="none" stroke="#3B2A1A" strokeWidth="4" strokeLinecap="round" />
            <circle cx="128" cy="172" r="6" fill="#FF8A80" opacity=".7" />
            <circle cx="192" cy="172" r="6" fill="#FF8A80" opacity=".7" />
          </g>
          <g className="pizzaWedge pizzaWedgeLeft">
            <path d="M160 40 L100 300 L40 300 Z" fill="#E8A03A" stroke="#7A4A16" strokeWidth="5" strokeLinejoin="round" />
            <path d="M160 58 L112 280 L58 288 Z" fill="#FFD84D" />
            <circle cx="125" cy="200" r="14" fill="#D9482B" />
          </g>
          <g className="pizzaWedge pizzaWedgeCenter">
            <path d="M160 40 L220 300 L100 300 Z" fill="#E8A03A" stroke="#7A4A16" strokeWidth="5" strokeLinejoin="round" />
            <path d="M160 58 L208 280 L112 280 Z" fill="#FFD84D" />
            <circle cx="160" cy="190" r="14" fill="#D9482B" />
          </g>
          <g className="pizzaWedge pizzaWedgeRight">
            <path d="M160 40 L280 300 L220 300 Z" fill="#E8A03A" stroke="#7A4A16" strokeWidth="5" strokeLinejoin="round" />
            <path d="M160 58 L262 288 L208 280 Z" fill="#FFD84D" />
            <circle cx="196" cy="200" r="14" fill="#D9482B" />
          </g>
          <g className="pizzaFace pizzaFaceLeft"><circle cx="70" cy="40" r="18" fill="#5BC0BE" /><circle cx="64" cy="38" r="3" fill="#1C2B39" /><circle cx="76" cy="38" r="3" fill="#1C2B39" /></g>
          <g className="pizzaFace pizzaFaceCenter"><circle cx="160" cy="8" r="18" fill="#F4A261" /><circle cx="154" cy="6" r="3" fill="#1C2B39" /><circle cx="166" cy="6" r="3" fill="#1C2B39" /></g>
          <g className="pizzaFace pizzaFaceRight"><circle cx="250" cy="40" r="18" fill="#9B5DE5" /><circle cx="244" cy="38" r="3" fill="#1C2B39" /><circle cx="256" cy="38" r="3" fill="#1C2B39" /></g>
        </svg>
      </div>
      {!compact && <span>Loading Pizza…</span>}
    </div>
  )
}
