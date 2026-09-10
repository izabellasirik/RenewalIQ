/**
 * Shared browser-side image decode/resize helpers used by both the OCR path (parseImage.ts) and
 * the vision-extraction path (visionExtraction.ts), so a photo is decoded/oriented identically no
 * matter which extraction path reads it.
 */

/**
 * Decodes with EXIF orientation applied — the single most common phone-photo problem (a document
 * shot in portrait that the camera tagged as rotated). `imageOrientation: 'from-image'` is the
 * standards-based way to get pixels that are actually right-side-up; browsers old enough to lack
 * it still decode the image, just without the correction, so this never blocks a valid upload.
 */
export async function decodeOriented(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

export function drawToCanvas(bitmap: ImageBitmap, maxDimension: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not prepare the image for reading.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}
