// Scan d'un QR code (ou code-barres) avec la caméra du téléphone ou de l'ordinateur.
import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from './kit';
import { Icon } from './icons';

export const canScanCamera = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/** Fenêtre de scan : chaque code lu est passé à `onCode` (plusieurs scans possibles d'affilée). */
export function ScanModal({ title = 'Scanner un QR code', onCode, onClose, keepOpen = true }: { title?: string; onCode: (text: string) => void; onClose: () => void; keepOpen?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(canScanCamera() ? null : 'Ce navigateur ne sait pas lire les QR codes avec la caméra. Utilisez Google Chrome (Android, Mac), un lecteur de code-barres, ou tapez le code.');
  const [last, setLast] = useState('');
  const cb = useRef(onCode); cb.current = onCode;
  useEffect(() => {
    if (!canScanCamera()) return;
    let stream: MediaStream | null = null, stop = false, timer = 0;
    const seen = new Map<string, number>();
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) return;
        const v = video.current!; v.srcObject = stream; await v.play();
        const det = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'ean_8', 'code_39'] });
        const tick = async () => {
          if (stop) return;
          try {
            const found = await det.detect(v);
            for (const f of found) {
              const t = String(f.rawValue || '').trim();
              if (!t) continue;
              const at = seen.get(t) ?? 0;
              if (Date.now() - at < 2500) continue; // le même code devant la caméra : une seule fois
              seen.set(t, Date.now());
              setLast(t);
              navigator.vibrate?.(60);
              cb.current(t);
              if (!keepOpen) { onClose(); return; }
            }
          } catch { /* image pas prête */ }
          timer = window.setTimeout(tick, 180);
        };
        tick();
      } catch (e: any) {
        setError(e?.name === 'NotAllowedError' ? 'Accès à la caméra refusé : autorisez la caméra pour ce site dans les réglages du navigateur.' : `Caméra indisponible : ${e?.message ?? e}`);
      }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <Modal title={title} onClose={onClose} footer={<Button onClick={onClose}>Terminé</Button>}>
      <div className="stack-s">
        {error ? <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>
          : <video ref={video} className="scan-video" playsInline muted />}
        <p className="small muted" style={{ margin: 0 }}>{last ? <>Dernier code lu : <strong>{last.length > 40 ? '…' + last.slice(-30) : last}</strong></> : 'Placez le QR code devant la caméra.'}</p>
      </div>
    </Modal>
  );
}
