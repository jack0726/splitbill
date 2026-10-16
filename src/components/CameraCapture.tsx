import { useEffect, useRef, useState } from 'react'

export default function CameraCapture({ onCaptured, onCancel }: { onCaptured: (photo: Blob) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this browser. Choose a photo instead.')
      return
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: false }).then((stream) => {
      if (!live) { stream.getTracks().forEach((track) => track.stop()); return }
      streamRef.current = stream
      if (video.current) {
        video.current.srcObject = stream
        video.current.play().catch(() => setError('Could not start the camera preview'))
      }
    }).catch((reason: unknown) => {
      const name = (reason as { name?: string }).name
      setError(name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser settings, or choose a photo.'
        : 'Could not open the camera. Choose a photo instead.')
    })
    return () => {
      live = false
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  function capture() {
    const source = video.current
    if (!source?.videoWidth || !source.videoHeight) return
    const scale = Math.min(1, 1024 / Math.max(source.videoWidth, source.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(source.videoWidth * scale)
    canvas.height = Math.round(source.videoHeight * scale)
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((photo) => {
      if (photo) onCaptured(photo)
      else setError('Could not capture the photo. Please try again.')
    }, 'image/jpeg', 0.9)
  }

  return (
    <div className="cameraCapture" role="dialog" aria-modal="true" aria-label="Take a selfie">
      <div className="cameraPreview">
        <video ref={video} autoPlay playsInline muted onPlaying={() => setReady(true)} />
        {error && <p className="cameraError">{error}</p>}
      </div>
      <div className="cameraBar">
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={capture} disabled={!ready}>Take photo</button>
      </div>
    </div>
  )
}
