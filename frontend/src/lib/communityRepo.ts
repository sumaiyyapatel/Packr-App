/**
 * Community on Firestore (Phase 3) — replaces the FastAPI /community/* API.
 *
 * Model:
 *   posts/{postId}                 post + denormalized counters
 *   posts/{postId}/likes/{uid}
 *   posts/{postId}/saves/{uid}
 *   posts/{postId}/comments/{id}
 *   posts/{postId}/reports/{uid}
 *   users/{uid}/saved_posts/{postId}   (owner-queryable saved list)
 *   follows/{followerUid_followingUid}
 *
 * Simplification vs. the old backend: every post is public to signed-in
 * users. The 'followers'/'private' visibility tiers were dropped because
 * Firestore list-query rules can't express them without denormalizing
 * follower lists into each post.
 */
import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit as qLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { getDb } from './firebase';
import type { CommunityComment, CommunityPost, SocialProfile, Trip, WardrobeItem } from './api';

function toIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function newId(): string {
  return doc(collection(getDb(), '_ids')).id;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------- enrichment ----------

async function latestComments(postId: string, count = 3): Promise<CommunityComment[]> {
  const snapshot = await getDocs(
    query(collection(getDb(), 'posts', postId, 'comments'), orderBy('created_at', 'desc'), qLimit(count))
  );
  return snapshot.docs
    .map((d) => ({ ...(d.data() as CommunityComment), id: d.id, created_at: toIso(d.data().created_at) }))
    .reverse();
}

async function enrichPost(raw: Record<string, unknown>, id: string, viewerUid: string): Promise<CommunityPost> {
  const db = getDb();
  const [likeSnap, saveSnap, followSnap, comments] = await Promise.all([
    getDoc(doc(db, 'posts', id, 'likes', viewerUid)),
    getDoc(doc(db, 'posts', id, 'saves', viewerUid)),
    getDoc(doc(db, 'follows', `${viewerUid}_${String(raw.author_id)}`)),
    latestComments(id),
  ]);
  return {
    ...(raw as unknown as CommunityPost),
    id,
    created_at: toIso(raw.created_at),
    is_liked: likeSnap.exists(),
    is_saved: saveSnap.exists(),
    is_following_author: followSnap.exists(),
    latest_comments: comments,
  };
}

async function enrichAll(
  docs: Array<{ id: string; data: Record<string, unknown> }>,
  viewerUid: string
): Promise<CommunityPost[]> {
  return Promise.all(docs.map((d) => enrichPost(d.data, d.id, viewerUid)));
}

// ---------- feeds ----------

export type FeedScope = 'public' | 'following' | 'saved' | 'mine';

export async function listPosts(viewerUid: string, scope: FeedScope, limit = 20): Promise<CommunityPost[]> {
  const db = getDb();

  if (scope === 'saved') {
    const saves = await getDocs(
      query(collection(db, 'users', viewerUid, 'saved_posts'), orderBy('created_at', 'desc'), qLimit(limit))
    );
    const posts = await Promise.all(
      saves.docs.map(async (save) => {
        const snapshot = await getDoc(doc(db, 'posts', save.id));
        return snapshot.exists() ? { id: snapshot.id, data: snapshot.data() as Record<string, unknown> } : null;
      })
    );
    return enrichAll(posts.filter((p): p is NonNullable<typeof p> => p !== null), viewerUid);
  }

  if (scope === 'mine') {
    const snapshot = await getDocs(
      query(collection(db, 'posts'), where('author_id', '==', viewerUid), orderBy('created_at', 'desc'), qLimit(limit))
    );
    return enrichAll(snapshot.docs.map((d) => ({ id: d.id, data: d.data() })), viewerUid);
  }

  if (scope === 'following') {
    const follows = await getDocs(
      query(collection(db, 'follows'), where('follower_id', '==', viewerUid), qLimit(30))
    );
    const followingIds = follows.docs.map((d) => String(d.data().following_id));
    if (!followingIds.length) return [];
    const results: Array<{ id: string; data: Record<string, unknown> }> = [];
    for (const ids of chunk(followingIds, 10)) {
      const snapshot = await getDocs(
        query(collection(db, 'posts'), where('author_id', 'in', ids), orderBy('created_at', 'desc'), qLimit(limit))
      );
      snapshot.docs.forEach((d) => results.push({ id: d.id, data: d.data() }));
    }
    results.sort((a, b) => String(b.data.created_at ?? '').localeCompare(String(a.data.created_at ?? '')));
    return enrichAll(results.slice(0, limit), viewerUid);
  }

  const snapshot = await getDocs(
    query(collection(db, 'posts'), orderBy('created_at', 'desc'), qLimit(limit))
  );
  return enrichAll(snapshot.docs.map((d) => ({ id: d.id, data: d.data() })), viewerUid);
}

export async function listTrending(viewerUid: string, destination?: string, limit = 20): Promise<CommunityPost[]> {
  const snapshot = await getDocs(
    query(collection(getDb(), 'posts'), orderBy('created_at', 'desc'), qLimit(100))
  );
  let docs = snapshot.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  if (destination?.trim()) {
    const needle = destination.trim().toLowerCase();
    docs = docs.filter((d) => String(d.data.destination ?? '').toLowerCase().includes(needle));
  }
  docs.sort((a, b) => {
    const score = (x: Record<string, unknown>) =>
      Number(x.likes_count ?? 0) * 3 + Number(x.saves_count ?? 0) * 2 + Number(x.comments_count ?? 0);
    return score(b.data) - score(a.data);
  });
  return enrichAll(docs.slice(0, limit), viewerUid);
}

export async function getPost(viewerUid: string, postId: string): Promise<CommunityPost> {
  const snapshot = await getDoc(doc(getDb(), 'posts', postId));
  if (!snapshot.exists()) throw new Error('Community post not found');
  return enrichPost(snapshot.data(), snapshot.id, viewerUid);
}

// ---------- create / delete ----------

export async function createPost(params: {
  uid: string;
  authorName: string;
  trip: Trip;
  wardrobeById: Record<string, WardrobeItem>;
  title: string;
  caption: string;
  imageDataUri: string; // client-rendered share card, already downscaled
}): Promise<CommunityPost> {
  const { trip } = params;
  const grid = trip.grid ?? [];
  if (grid.length !== 9 || grid.some((slot) => !slot)) {
    throw new Error('Complete all 9 grid slots before sharing');
  }
  const items = grid.map((itemId, slot) => {
    const item = params.wardrobeById[itemId as string];
    if (!item) throw new Error('Grid contains items that are no longer in your wardrobe');
    // Snapshot without images: keeps the post document far below the 1 MB cap.
    return {
      slot,
      name: item.name,
      category: item.category,
      image: '',
      colors: item.colors ?? [],
      tags: item.tags ?? [],
      weight_kg: item.weight_kg ?? 0,
    };
  });
  const dominant = items.flatMap((i) => i.colors).filter((c, i, a) => a.indexOf(c) === i).slice(0, 9);
  const days = Math.max(
    1,
    Math.round((Date.parse(trip.end_date) - Date.parse(trip.start_date)) / 86_400_000) + 1
  );
  const id = newId();
  const data = {
    author_id: params.uid,
    author_name: params.authorName,
    trip_id: trip.id,
    title: params.title.trim().slice(0, 80) || `${trip.destination} packing grid`,
    caption: params.caption.trim().slice(0, 220),
    visibility: 'public' as const,
    destination: trip.destination,
    start_date: trip.start_date,
    end_date: trip.end_date,
    days,
    image_url: params.imageDataUri,
    image_width: 0,
    image_height: 0,
    dominant_colors: dominant,
    grid,
    items_snapshot: items,
    likes_count: 0,
    comments_count: 0,
    saves_count: 0,
    created_at: serverTimestamp(),
  };
  await setDoc(doc(getDb(), 'posts', id), data);
  return {
    ...(data as unknown as CommunityPost),
    id,
    created_at: new Date().toISOString(),
    is_liked: false,
    is_saved: false,
    is_following_author: false,
    latest_comments: [],
  };
}

export async function deletePost(uid: string, postId: string): Promise<void> {
  const db = getDb();
  // Best-effort subcollection cleanup (no Admin SDK on Spark).
  for (const sub of ['likes', 'saves', 'comments', 'reports']) {
    const snapshot = await getDocs(query(collection(db, 'posts', postId, sub), qLimit(200)));
    if (snapshot.empty) continue;
    const batch = writeBatch(db);
    snapshot.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await deleteDoc(doc(db, 'users', uid, 'saved_posts', postId));
  await deleteDoc(doc(db, 'posts', postId));
}

// ---------- reactions ----------

export async function setLike(uid: string, postId: string, liked: boolean): Promise<void> {
  const db = getDb();
  const likeRef = doc(db, 'posts', postId, 'likes', uid);
  const postRef = doc(db, 'posts', postId);
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(likeRef);
    if (liked && !existing.exists()) {
      tx.set(likeRef, { user_id: uid, created_at: serverTimestamp() });
      tx.update(postRef, { likes_count: increment(1) });
    } else if (!liked && existing.exists()) {
      tx.delete(likeRef);
      tx.update(postRef, { likes_count: increment(-1) });
    }
  });
}

export async function setSave(uid: string, postId: string, saved: boolean): Promise<void> {
  const db = getDb();
  const saveRef = doc(db, 'posts', postId, 'saves', uid);
  const userSaveRef = doc(db, 'users', uid, 'saved_posts', postId);
  const postRef = doc(db, 'posts', postId);
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(saveRef);
    if (saved && !existing.exists()) {
      tx.set(saveRef, { user_id: uid, created_at: serverTimestamp() });
      tx.set(userSaveRef, { post_id: postId, created_at: serverTimestamp() });
      tx.update(postRef, { saves_count: increment(1) });
    } else if (!saved && existing.exists()) {
      tx.delete(saveRef);
      tx.delete(userSaveRef);
      tx.update(postRef, { saves_count: increment(-1) });
    }
  });
}

export async function addComment(
  uid: string,
  userName: string,
  postId: string,
  text: string
): Promise<void> {
  const value = text.trim().replace(/\s+/g, ' ');
  if (!value) throw new Error('Comment cannot be empty');
  if (value.length > 500) throw new Error('Comment must be 500 characters or less');
  const db = getDb();
  const batch = writeBatch(db);
  batch.set(doc(db, 'posts', postId, 'comments', newId()), {
    post_id: postId,
    user_id: uid,
    user_name: userName,
    text: value,
    created_at: serverTimestamp(),
  });
  batch.update(doc(db, 'posts', postId), { comments_count: increment(1) });
  await batch.commit();
}

export async function deleteComment(postId: string, commentId: string): Promise<void> {
  const db = getDb();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'posts', postId, 'comments', commentId));
  batch.update(doc(db, 'posts', postId), { comments_count: increment(-1) });
  await batch.commit();
}

export async function reportPost(uid: string, postId: string, reason: string): Promise<void> {
  await setDoc(doc(getDb(), 'posts', postId, 'reports', uid), {
    reporter_id: uid,
    reason: reason.slice(0, 500),
    created_at: serverTimestamp(),
  });
}

// ---------- social graph ----------

export async function setFollow(uid: string, targetUid: string, following: boolean): Promise<void> {
  if (uid === targetUid) throw new Error('You cannot follow yourself');
  const edgeRef = doc(getDb(), 'follows', `${uid}_${targetUid}`);
  if (following) {
    await setDoc(edgeRef, {
      follower_id: uid,
      following_id: targetUid,
      created_at: serverTimestamp(),
    });
  } else {
    await deleteDoc(edgeRef);
  }
}

export async function getProfile(viewerUid: string, uid: string, knownName?: string | null): Promise<SocialProfile> {
  const db = getDb();
  const [followers, following, posts, edge, reverseEdge] = await Promise.all([
    getCountFromServer(query(collection(db, 'follows'), where('following_id', '==', uid))),
    getCountFromServer(query(collection(db, 'follows'), where('follower_id', '==', uid))),
    getCountFromServer(query(collection(db, 'posts'), where('author_id', '==', uid))),
    getDoc(doc(db, 'follows', `${viewerUid}_${uid}`)),
    getDoc(doc(db, 'follows', `${uid}_${viewerUid}`)),
  ]);
  return {
    id: uid,
    name: knownName ?? null,
    is_following: edge.exists(),
    is_friend: edge.exists() && reverseEdge.exists(),
    followers_count: followers.data().count,
    following_count: following.data().count,
    posts_count: posts.data().count,
  };
}
