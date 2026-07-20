/**
 * On-device image downscaling so wardrobe photos can live inline in
 * Firestore documents (Spark plan — no Cloud Storage). A 640px JPEG at
 * q0.7 is typically 30–80 KB; Firestore's document limit is ~1 MB.
 */
import * as ImageManipulator from 'expo-image-manipulator';

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
