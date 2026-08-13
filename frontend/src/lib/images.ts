/**
 * On-device image downscaling so wardrobe photos can live inline in
 * Firestore documents (Spark plan — no Cloud Storage). A 640px JPEG at
 * q0.7 is typically 30–80 KB; Firestore's document limit is ~1 MB.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { Image as RNImage } from 'react-native';

const MAX_INLINE_BYTES = 700_000;

export async function downscaleToDataUri(
  uri: string,
  maxWidth = 640,
  quality = 0.7
): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  return `data:image/jpeg;base64,${result.base64}`;
}

/**
 * Guarantees a data URI small enough to embed in a Firestore document.
 * Re-compresses progressively if needed (e.g. large PNG cutouts).
 */
export async function ensureFirestoreSafeImage(dataUri: string): Promise<string> {
  if (!dataUri.startsWith('data:') || dataUri.length <= MAX_INLINE_BYTES) return dataUri;
  let result = await downscaleToDataUri(dataUri, 512, 0.6);
  if (result.length > MAX_INLINE_BYTES) {
    result = await downscaleToDataUri(dataUri, 384, 0.5);
  }
  if (result.length > MAX_INLINE_BYTES) {
    throw new Error('Image is too large to save. Try a smaller photo.');
  }
  return result;
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

export type CropRegion = 'center' | 'left' | 'right' | 'top' | 'bottom';

/**
 * Deterministic crop presets — no live gesture/transform math to get subtly
 * wrong. Lets a user isolate one garment from a multi-item photo (a catalog
 * screenshot, a flat-lay of several pieces) with one tap instead of freehand
 * dragging. 'center' crops to a square; the half-regions keep full-bleed on
 * the kept axis so a two-up or stacked photo splits cleanly.
 */
export async function cropRegionDataUri(uri: string, region: CropRegion): Promise<string> {
  const { width, height } = await getImageSize(uri);
  let crop: { originX: number; originY: number; width: number; height: number };
  switch (region) {
    case 'left':
      crop = { originX: 0, originY: 0, width: width / 2, height };
      break;
    case 'right':
      crop = { originX: width / 2, originY: 0, width: width / 2, height };
      break;
    case 'top':
      crop = { originX: 0, originY: 0, width, height: height / 2 };
      break;
    case 'bottom':
      crop = { originX: 0, originY: height / 2, width, height: height / 2 };
      break;
    case 'center':
    default: {
      const side = Math.min(width, height);
      crop = { originX: (width - side) / 2, originY: (height - side) / 2, width: side, height: side };
    }
  }
  const result = await ImageManipulator.manipulateAsync(uri, [{ crop }], {
    compress: 0.85,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  return `data:image/jpeg;base64,${result.base64}`;
}
