// Photos : toujours le même traitement avant d'être enregistrées, quel que soit l'écran.
// 1. redimensionner → 2. convertir en JPEG sur fond blanc → 3. compresser jusqu'au poids visé en gardant une qualité
// suffisante pour bien reconnaître l'article → 4. seulement ensuite, enregistrer dans la base.
// Normes (une seule place pour les régler) :
//  - photo d'article ou de variante : 600 px au plus grand côté, ~50 Ko (net sur téléphone et sur le ticket) ;
//  - photo de reçu / justificatif : 1000 px, ~110 Ko (le texte doit rester lisible) ;
//  - logo (société, page) : 256 px, ~40 Ko.
export const PHOTO = { max: 600, targetBytes: 50_000, qualities: [0.8, 0.74, 0.68, 0.62, 0.56, 0.5] };
export const RECEIPT = { max: 1000, targetBytes: 110_000 };
export const LOGO = { max: 256, targetBytes: 40_000 };
/** Une image est « trop lourde » au-delà de 15 % du poids visé, ou si elle n'est pas en JPEG (PNG, WEBP…). */
export const tooHeavy = (dataUrl: string | undefined, target: number, allowPng = false) =>
  !!dataUrl && dataUrl.startsWith('data:image') && (bytesOf(dataUrl) > target * 1.15 || (!allowPng && !dataUrl.startsWith('data:image/jpeg')));

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Photo illisible. Choisissez une image JPG, PNG ou WEBP.'));
    img.src = URL.createObjectURL(blob);
  });
}
function bytesOf(dataUrl: string) { return Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75); }

/** Retourne la photo prête à enregistrer (data URL JPEG légère). */
export async function compressPhoto(src: Blob | string, opts: { max?: number; targetBytes?: number } = {}): Promise<string> {
  const max = opts.max ?? PHOTO.max, target = opts.targetBytes ?? PHOTO.targetBytes;
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  const img = await loadImage(blob);
  try {
    let scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    let best = '';
    for (let pass = 0; pass < 7; pass++) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      for (const q of PHOTO.qualities) {
        best = c.toDataURL('image/jpeg', q);
        if (bytesOf(best) <= target) return best;
      }
      scale *= 0.8; // encore trop lourde : on réduit un peu la taille et on recommence
    }
    return best;
  } finally { URL.revokeObjectURL(img.src); }
}
export const photoBytes = (dataUrl?: string) => (dataUrl ? bytesOf(dataUrl) : 0);
