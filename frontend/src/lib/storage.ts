/**
 * Firebase Storage uploads (replaces the FastAPI /uploads/* endpoints).
 * Uses the Firebase JS SDK — no native module, works in Expo Go and dev builds.
 */
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { getFirebaseApp } from './firebase';

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function dataUriToBlob(dataUri: string): Promise<Blob> {
  // RN's fetch handles data: URIs natively.
  const response = await fetch(dataUri);
  return response.blob();
}

/** Uploads a data-URI image and returns its public download URL. */
export async function uploadImage(
  folder: 'wardrobe' | 'posts',
  uid: string,
  dataUri: string
): Promise<string> {
  if (!dataUri.startsWith('data:')) return dataUri; // already a URL
  const storage = getStorage(getFirebaseApp());
  const isPng = dataUri.startsWith('data:image/png');
  const target = ref(storage, `${folder}/${uid}/${randomId()}.${isPng ? 'png' : 'jpg'}`);
  const blob = await dataUriToBlob(dataUri);
  await uploadBytes(target, blob, { contentType: isPng ? 'image/png' : 'image/jpeg' });
  return getDownloadURL(target);
}

export async function uploadWardrobeImage(uid: string, dataUri: string): Promise<string> {
  return uploadImage('wardrobe', uid, dataUri);
}

/** Best-effort delete of a previously uploaded image by its download URL. */
export async function deleteImageByUrl(url: string): Promise<void> {
  if (!url || !url.includes('firebasestorage')) return;
  try {
    const storage = getStorage(getFirebaseApp());
    await deleteObject(ref(storage, url));
  } catch {
    // Missing object or foreign URL — never block the caller on cleanup.
  }
}
