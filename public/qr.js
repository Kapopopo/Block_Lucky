// ---------------------------------------------------------------------------
// QR codes : bibliothèque qrcode-generator chargée seulement quand on en a besoin.
// Utilisé par le tuto MetaMask mobile et par les affiches à imprimer (Espace admin).
// ---------------------------------------------------------------------------
let lib = null;

/** Construit la matrice du QR code (correction d'erreur « M » : reste lisible même un peu abîmé). */
export async function makeQr(text) {
  lib ??= (await import('/vendor/qrcode.js')).default;
  const qr = lib(0, 'M');
  qr.addData(text);
  qr.make();
  return qr;
}

/** QR code en SVG, qui s'adapte à la taille de son conteneur. */
export async function qrSvg(text, margin = 2) {
  return (await makeQr(text)).createSvgTag({ cellSize: 4, margin, scalable: true });
}

/**
 * Image PNG d'une affiche : le QR code, un titre et l'adresse en dessous.
 * Dessinée module par module sur un canvas, donc nette à l'impression.
 */
export async function qrPng({ text, title, caption }, size = 1200) {
  const qr = await makeQr(text);
  const count = qr.getModuleCount();
  const quiet = 4; // marge blanche réglementaire autour du QR code (4 modules)
  const cell = Math.floor(size / (count + quiet * 2));
  const qrSize = cell * (count + quiet * 2);
  const textHeight = Math.round(size * 0.2);
  const canvas = Object.assign(document.createElement('canvas'), { width: qrSize, height: qrSize + textHeight });
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const fit = (value, weight, px) => {
    let s = px;
    g.font = `${weight} ${s}px ${font}`;
    while (s > 12 && g.measureText(value).width > qrSize * 0.9) g.font = `${weight} ${--s}px ${font}`;
  };
  fit(title, 700, Math.round(textHeight * 0.32));
  g.fillText(title, qrSize / 2, qrSize + textHeight * 0.3);
  g.fillStyle = '#444';
  fit(caption, 500, Math.round(textHeight * 0.18));
  g.fillText(caption, qrSize / 2, qrSize + textHeight * 0.66);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
