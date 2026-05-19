import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { captureRef } from 'react-native-view-shot';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useStore } from '../../src/lib/store';
import { api, CommunityChallenge, CommunityPost, CommunitySnapshotItem, getApiErrorMessage, resolveApiAssetUrl, SocialProfile, Trip } from '../../src/lib/api';
import { categoryForSlot } from '../../src/lib/sudoku';
import { CATEGORY_META } from '../../src/lib/wardrobeMeta';

type FeedScope = 'public' | 'trending' | 'following' | 'saved' | 'mine';

const SCOPES: { id: FeedScope; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'public', label: 'Explore', icon: 'globe-outline' },
  { id: 'trending', label: 'Trending', icon: 'trending-up-outline' },
  { id: 'following', label: 'Following', icon: 'people-outline' },
  { id: 'saved', label: 'Saved', icon: 'bookmark-outline' },
  { id: 'mine', label: 'Mine', icon: 'person-circle-outline' },
];

const VISIBILITIES: { id: CommunityPost['visibility']; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'public', label: 'Public', icon: 'globe-outline' },
  { id: 'followers', label: 'Followers', icon: 'people-outline' },
  { id: 'private', label: 'Private', icon: 'lock-closed-outline' },
];

export default function CommunityScreen() {
  const { c } = useTheme();
  const user = useStore((s) => s.user);
  const trips = useStore((s) => s.trips);
  const wardrobe = useStore((s) => s.wardrobe);
  const selectedTripId = useStore((s) => s.selectedTripId);
  const trip = trips.find((t) => t.id === selectedTripId) || trips[0] || null;
  const [scope, setScope] = useState<FeedScope>('public');
  const [visibility, setVisibility] = useState<CommunityPost['visibility']>('public');
  const [caption, setCaption] = useState('');
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(new Set());
  const [challenges, setChallenges] = useState<CommunityChallenge[]>([]);
  const shareCardRef = useRef<View>(null);

  const itemsById = useMemo(() => {
    const map: Record<string, CommunitySnapshotItem> = {};
    for (const item of wardrobe) {
      map[item.id] = {
        slot: 0,
        name: item.name,
        category: item.category,
        image: item.image,
        colors: item.colors,
        tags: item.tags,
        weight_kg: item.weight_kg,
      };
    }
    return map;
  }, [wardrobe]);

  const selectedTripComplete = useMemo(() => {
    return Boolean(trip?.grid?.length === 9 && trip.grid.every(Boolean));
  }, [trip]);

  const loadPosts = useCallback(async () => {
    try {
      const r = scope === 'trending'
        ? await api.get('/community/trending', { params: { destination: trip?.destination } })
        : await api.get('/community/posts', { params: { scope } });
      setPosts(r.data);
    } catch (e: unknown) {
      Alert.alert('Feed failed', getApiErrorMessage(e, 'Could not load community posts'));
    } finally {
      setLoading(false);
    }
  }, [scope, trip?.destination]);

  const loadProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      const r = await api.get(`/users/${user.id}`);
      setProfile(r.data);
    } catch {}
  }, [user?.id]);

  useEffect(() => {
    setLoading(true);
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/community/challenges');
        setChallenges(r.data);
      } catch {}
    })();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await loadPosts();
    setRefreshing(false);
  };

  const replacePost = (next: CommunityPost) => {
    setPosts((current) => current.map((post) => (post.id === next.id ? next : post)));
  };

  const applyAuthorProfile = (profile: SocialProfile) => {
    setPosts((current) =>
      current
        .map((item) =>
          item.author_id === profile.id
            ? { ...item, is_following_author: profile.is_following }
            : item
        )
        .filter((item) => {
          if (item.author_id === user?.id) return true;
          if (scope === 'following') return item.author_id !== profile.id || profile.is_following;
          if (scope === 'saved' && item.author_id === profile.id && item.visibility === 'followers') {
            return profile.is_following;
          }
          return true;
        })
    );
  };

  const shareTrip = async () => {
    if (!trip) {
      Alert.alert('No trip', 'Create a trip before sharing a post.');
      return;
    }
    if (!selectedTripComplete) {
      Alert.alert('Complete grid', 'Fill all 9 slots before sharing a post.');
      return;
    }
    setPosting(true);
    try {
      if (!shareCardRef.current) {
        throw new Error('Share card is not ready');
      }
      const image = await captureRef(shareCardRef.current, {
        format: 'jpg',
        quality: 0.86,
        result: 'data-uri',
      });
      const upload = await api.post('/uploads/community-post-image', { image });
      const r = await api.post('/community/posts', {
        trip_id: trip.id,
        title: `${trip.destination} packing post`,
        caption,
        visibility,
        image_url: upload.data.url,
        image_width: upload.data.width,
        image_height: upload.data.height,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCaption('');
      setPosts((current) => [r.data, ...current.filter((post) => post.id !== r.data.id)]);
      loadProfile();
      if (scope !== 'public' && visibility === 'public') setScope('public');
    } catch (e: unknown) {
      Alert.alert('Share failed', getApiErrorMessage(e, 'Could not share this post'));
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (post: CommunityPost) => {
    setBusyPostId(post.id);
    try {
      const r = post.is_liked
        ? await api.delete(`/community/posts/${post.id}/like`)
        : await api.post(`/community/posts/${post.id}/like`);
      replacePost(r.data);
    } catch (e: unknown) {
      Alert.alert('Action failed', getApiErrorMessage(e, 'Could not update like'));
    } finally {
      setBusyPostId(null);
    }
  };

  const toggleSave = async (post: CommunityPost) => {
    setBusyPostId(post.id);
    try {
      const r = post.is_saved
        ? await api.delete(`/community/posts/${post.id}/save`)
        : await api.post(`/community/posts/${post.id}/save`);
      if (scope === 'saved' && post.is_saved) {
        setPosts((current) => current.filter((item) => item.id !== post.id));
      } else {
        replacePost(r.data);
      }
    } catch (e: unknown) {
      Alert.alert('Action failed', getApiErrorMessage(e, 'Could not update saved post'));
    } finally {
      setBusyPostId(null);
    }
  };

  const toggleFollow = async (post: CommunityPost) => {
    if (post.author_id === user?.id) return;
    setBusyPostId(post.id);
    try {
      const r = await (post.is_following_author
        ? api.delete(`/users/${post.author_id}/follow`)
        : api.post(`/users/${post.author_id}/follow`));
      applyAuthorProfile(r.data);
      loadProfile();
    } catch (e: unknown) {
      Alert.alert('Follow failed', getApiErrorMessage(e, 'Could not update follow'));
    } finally {
      setBusyPostId(null);
    }
  };

  const addComment = async (post: CommunityPost) => {
    const text = (comments[post.id] || '').trim();
    if (!text) return;
    setBusyPostId(post.id);
    try {
      const r = await api.post(`/community/posts/${post.id}/comments`, { text });
      setComments((current) => ({ ...current, [post.id]: '' }));
      replacePost(r.data);
    } catch (e: unknown) {
      Alert.alert('Comment failed', getApiErrorMessage(e, 'Could not add comment'));
    } finally {
      setBusyPostId(null);
    }
  };

  const deleteComment = async (post: CommunityPost, commentId: string) => {
    setBusyPostId(post.id);
    try {
      const r = await api.delete(`/community/posts/${post.id}/comments/${commentId}`);
      replacePost(r.data);
    } catch (e: unknown) {
      Alert.alert('Delete failed', getApiErrorMessage(e, 'Could not delete comment'));
    } finally {
      setBusyPostId(null);
    }
  };

  const deletePost = async (post: CommunityPost) => {
    Alert.alert('Delete post?', post.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusyPostId(post.id);
          try {
            await api.delete(`/community/posts/${post.id}`);
            setPosts((current) => current.filter((item) => item.id !== post.id));
            loadProfile();
          } catch (e: unknown) {
            Alert.alert('Delete failed', getApiErrorMessage(e, 'Could not delete post'));
          } finally {
            setBusyPostId(null);
          }
        },
      },
    ]);
  };

  const reportPost = async (post: CommunityPost) => {
    Alert.alert('Report post?', post.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: async () => {
          setBusyPostId(post.id);
          try {
            await api.post(`/community/posts/${post.id}/report`, { reason: 'Reported from Android app' });
            setHiddenPostIds((current) => new Set([...current, post.id]));
          } catch (e: unknown) {
            Alert.alert('Report failed', getApiErrorMessage(e, 'Could not report post'));
          } finally {
            setBusyPostId(null);
          }
        },
      },
    ]);
  };

  const voteChallengePost = async (post: CommunityPost) => {
    const challenge = challenges[0];
    if (!challenge) return;
    setBusyPostId(post.id);
    try {
      await api.post(`/community/challenges/${challenge.id}/posts/${post.id}/vote`);
      Haptics.selectionAsync().catch(() => {});
      setChallenges((current) =>
        current.map((item, index) => index === 0 ? { ...item, votes_count: item.votes_count + 1 } : item)
      );
    } catch (e: unknown) {
      Alert.alert('Vote failed', getApiErrorMessage(e, 'Could not vote for this post'));
    } finally {
      setBusyPostId(null);
    }
  };

  const reportComment = async (post: CommunityPost, commentId: string) => {
    setBusyPostId(post.id);
    try {
      await api.post(`/community/posts/${post.id}/comments/${commentId}/report`, {
        reason: 'Reported from Android app',
      });
      const r = await api.get(`/community/posts/${post.id}`);
      replacePost(r.data);
    } catch (e: unknown) {
      Alert.alert('Report failed', getApiErrorMessage(e, 'Could not report comment'));
    } finally {
      setBusyPostId(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.accent} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.kicker, { color: c.accent }]}>COMMUNITY</Text>
            <Text style={[styles.h1, { color: c.textPrimary }]}>Travel feed</Text>
            <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 4 }}>
              Save packing ideas, comment, and follow packers.
            </Text>
          </View>
          <Pressable onPress={refresh} style={[styles.iconBtn, { borderColor: c.borderSubtle }]}>
            <Ionicons name="refresh-outline" size={18} color={c.textPrimary} />
          </Pressable>
        </View>

        <ProfileCard
          name={user?.name || null}
          email={user?.email || ''}
          profile={profile}
          onMine={() => setScope('mine')}
        />

        <View style={[styles.sharePanel, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
          <View style={styles.shareTop}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.textPrimary, fontWeight: '700', fontSize: 15 }}>
                {trip ? `Share ${trip.destination}` : 'Share a post'}
              </Text>
              <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 3 }}>
                {trip ? `${tripDaysLabel(trip)} - one compressed screenshot` : 'Create a trip first'}
              </Text>
            </View>
            {posting ? <ActivityIndicator color={c.accent} /> : null}
          </View>

          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Add a caption"
            placeholderTextColor={c.textTertiary}
            maxLength={220}
            multiline
            style={[
              styles.captionInput,
              {
                color: c.textPrimary,
                borderColor: c.borderSubtle,
                backgroundColor: c.elevated,
              },
            ]}
          />

          {trip && selectedTripComplete ? (
            <ShareGridCard ref={shareCardRef} trip={trip} itemsById={itemsById} />
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.visibilityRow}>
            {VISIBILITIES.map((item) => {
              const active = visibility === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setVisibility(item.id)}
                  style={[
                    styles.visibilityChip,
                    {
                      borderColor: active ? c.accent : c.borderSubtle,
                      backgroundColor: active ? c.accent : 'transparent',
                    },
                  ]}
                >
                  <Ionicons name={item.icon} size={14} color={active ? c.bg : c.textSecondary} />
                  <Text style={{ color: active ? c.bg : c.textSecondary, fontSize: 11, fontWeight: '700' }}>
                    {item.label.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            testID="community-share-button"
            onPress={shareTrip}
            disabled={posting || !trip || !selectedTripComplete}
            style={[
              styles.shareButton,
              {
                backgroundColor: posting || !trip || !selectedTripComplete ? c.borderActive : c.accent,
              },
            ]}
          >
            <Ionicons name="share-social-outline" size={16} color={c.bg} />
            <Text style={{ color: c.bg, fontSize: 12, letterSpacing: 1, fontWeight: '800' }}>
              SHARE SCREENSHOT
            </Text>
          </Pressable>
        </View>

        {challenges.length > 0 && (
          <View style={{ marginTop: 18 }}>
            <View style={styles.challengeHeader}>
              <Text style={[styles.kicker, { color: c.textPrimary }]}>MONTHLY CHALLENGES</Text>
              <Text style={{ color: c.textTertiary, fontSize: 11 }}>{challenges[0].month}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 10 }}>
              {challenges.map((challenge) => (
                <ChallengeCard
                  key={challenge.id}
                  challenge={challenge}
                  onTrending={() => setScope('trending')}
                />
              ))}
            </ScrollView>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 18 }}
        >
          {SCOPES.map((item) => {
            const active = scope === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setScope(item.id)}
                style={[
                  styles.scopeChip,
                  {
                    borderColor: active ? c.accent : c.borderSubtle,
                    backgroundColor: active ? c.accent : 'transparent',
                  },
                ]}
              >
                <Ionicons name={item.icon} size={15} color={active ? c.bg : c.textSecondary} />
                <Text style={{ color: active ? c.bg : c.textSecondary, fontSize: 11, fontWeight: '700' }}>
                  {item.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={c.accent} />
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={32} color={c.textTertiary} />
            <Text style={{ color: c.textSecondary, textAlign: 'center', marginTop: 10 }}>
              No community posts here yet.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {posts.filter((post) => !hiddenPostIds.has(post.id)).map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUserId={user?.id || null}
                busy={busyPostId === post.id}
                commentValue={comments[post.id] || ''}
                onCommentChange={(text) => setComments((current) => ({ ...current, [post.id]: text }))}
                onLike={() => toggleLike(post)}
                onSave={() => toggleSave(post)}
                onFollow={() => toggleFollow(post)}
                onComment={() => addComment(post)}
                onDeleteComment={(commentId) => deleteComment(post, commentId)}
                onDeletePost={() => deletePost(post)}
                onReportPost={() => reportPost(post)}
                onReportComment={(commentId) => reportComment(post, commentId)}
                onChallengeVote={() => voteChallengePost(post)}
                challengeActive={challenges.length > 0}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileCard({
  name,
  email,
  profile,
  onMine,
}: {
  name: string | null;
  email: string;
  profile: SocialProfile | null;
  onMine: () => void;
}) {
  const { c } = useTheme();
  const displayName = name || email.split('@')[0] || 'Packr';
  const handle = `@${email.split('@')[0] || 'packr'}`;
  return (
    <View style={[styles.profileCard, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
      <View style={styles.profileTop}>
        <View style={[styles.profileAvatar, { backgroundColor: c.elevated, borderColor: c.accent }]}>
          <Text style={{ color: c.textPrimary, fontSize: 19, fontWeight: '900' }}>{initials(displayName)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 18, fontWeight: '900' }}>
            {displayName}
          </Text>
          <Text numberOfLines={1} style={{ color: c.textTertiary, fontSize: 12, marginTop: 2 }}>
            {handle}
          </Text>
        </View>
        <Pressable onPress={onMine} style={[styles.profileButton, { borderColor: c.accent }]}>
          <Ionicons name="person-circle-outline" size={15} color={c.accent} />
          <Text style={{ color: c.accent, fontSize: 11, fontWeight: '900' }}>POSTS</Text>
        </Pressable>
      </View>

      <View style={styles.profileStats}>
        <ProfileStat label="POSTS" value={profile?.posts_count ?? 0} />
        <ProfileStat label="FOLLOWERS" value={profile?.followers_count ?? 0} />
        <ProfileStat label="FOLLOWING" value={profile?.following_count ?? 0} />
      </View>
    </View>
  );
}

function ProfileStat({ label, value }: { label: string; value: number }) {
  const { c } = useTheme();
  return (
    <View style={styles.profileStat}>
      <Text style={{ color: c.textPrimary, fontSize: 17, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: c.textTertiary, fontSize: 9, letterSpacing: 1, fontWeight: '800' }}>{label}</Text>
    </View>
  );
}

const ShareGridCard = React.forwardRef<View, { trip: Trip; itemsById: Record<string, CommunitySnapshotItem> }>(
  function ShareGridCard({ trip, itemsById }, ref) {
    const { c } = useTheme();
    return (
      <View
        ref={ref}
        collapsable={false}
        style={[styles.sharePreviewCard, { backgroundColor: c.bg, borderColor: c.borderSubtle }]}
      >
        <View style={styles.sharePreviewHeader}>
          <View>
            <Text style={{ color: c.accent, fontSize: 11, letterSpacing: 2, fontWeight: '900' }}>PACKR GRID</Text>
            <Text style={{ color: c.textPrimary, fontSize: 24, fontWeight: '900', marginTop: 2 }} numberOfLines={1}>
              {trip.destination}
            </Text>
          </View>
          <Text style={{ color: c.textTertiary, fontSize: 11, fontWeight: '800' }}>
            {tripDaysLabel(trip)}
          </Text>
        </View>
        <View style={[styles.sharePreviewGrid, { borderColor: c.borderSubtle }]}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={styles.gridRow}>
              {[0, 1, 2].map((col) => {
                const slot = row * 3 + col;
                const itemId = trip.grid[slot];
                const item = itemId ? itemsById[itemId] : null;
                const meta = CATEGORY_META[item?.category || categoryForSlot(slot)];
                return (
                  <View
                    key={slot}
                    style={[styles.sharePreviewSlot, { backgroundColor: meta.soft, borderColor: meta.color + '66' }]}
                  >
                    <View style={[styles.previewAccent, { backgroundColor: meta.color }]} />
                    {item?.image ? (
                      <Image source={{ uri: resolveApiAssetUrl(item.image) }} style={styles.sharePreviewImage} contentFit="contain" />
                    ) : (
                      <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={22} color={meta.color} />
                    )}
                    <Text style={{ color: c.textPrimary, fontSize: 9, fontWeight: '800', marginTop: 3 }} numberOfLines={1}>
                      {item?.name || meta.short}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
        <View style={styles.sharePreviewFooter}>
          <Text style={{ color: c.textPrimary, fontSize: 12, fontWeight: '900' }}>9 items</Text>
          <Text style={{ color: c.textPrimary, fontSize: 12, fontWeight: '900' }}>27 outfits</Text>
          <Text style={{ color: c.accent, fontSize: 12, fontWeight: '900' }}>packr</Text>
        </View>
      </View>
    );
  }
);

function ChallengeCard({
  challenge,
  onTrending,
}: {
  challenge: CommunityChallenge;
  onTrending: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onTrending}
      style={[styles.challengeCard, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}
    >
      <View style={[styles.challengeIcon, { borderColor: c.accent }]}>
        <Ionicons name="trophy-outline" size={18} color={c.accent} />
      </View>
      <Text style={{ color: c.textPrimary, fontSize: 15, fontWeight: '900', marginTop: 10 }}>
        {challenge.title}
      </Text>
      <Text style={{ color: c.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 }} numberOfLines={3}>
        {challenge.prompt}
      </Text>
      <View style={styles.challengeStats}>
        <Text style={{ color: c.textTertiary, fontSize: 10, fontWeight: '800' }}>
          {challenge.posts_count} POSTS
        </Text>
        <Text style={{ color: c.textTertiary, fontSize: 10, fontWeight: '800' }}>
          {challenge.votes_count} VOTES
        </Text>
      </View>
    </Pressable>
  );
}

function PostCard({
  post,
  currentUserId,
  busy,
  commentValue,
  onCommentChange,
  onLike,
  onSave,
  onFollow,
  onComment,
  onDeleteComment,
  onDeletePost,
  onReportPost,
  onReportComment,
  onChallengeVote,
  challengeActive,
}: {
  post: CommunityPost;
  currentUserId: string | null;
  busy: boolean;
  commentValue: string;
  onCommentChange: (text: string) => void;
  onLike: () => void;
  onSave: () => void;
  onFollow: () => void;
  onComment: () => void;
  onDeleteComment: (commentId: string) => void;
  onDeletePost: () => void;
  onReportPost: () => void;
  onReportComment: (commentId: string) => void;
  onChallengeVote: () => void;
  challengeActive: boolean;
}) {
  const { c } = useTheme();
  const isOwnPost = post.author_id === currentUserId;
  const bySlot = useMemo(() => {
    const map: Record<number, CommunitySnapshotItem> = {};
    for (const item of post.items_snapshot) map[item.slot] = item;
    return map;
  }, [post.items_snapshot]);
  const postImage = post.image_url ? resolveApiAssetUrl(post.image_url) : '';
  const swatches = (post.dominant_colors?.length ? post.dominant_colors : post.items_snapshot.flatMap((item) => item.colors)).slice(0, 9);

  return (
    <View style={[styles.postCard, { borderColor: c.borderSubtle, backgroundColor: c.surface }]}>
      <View style={styles.postHeader}>
        <View style={[styles.avatar, { backgroundColor: c.elevated, borderColor: c.borderSubtle }]}>
          <Text style={{ color: c.textPrimary, fontSize: 13, fontWeight: '800' }}>
            {initials(post.author_name)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.textPrimary, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>
            {post.author_name}
          </Text>
          <Text style={{ color: c.textTertiary, fontSize: 11, marginTop: 2 }}>
            {post.destination} - {post.days} {post.days === 1 ? 'day' : 'days'}
          </Text>
        </View>
        {!isOwnPost ? (
          <View style={styles.ownerActions}>
            <Pressable
              onPress={onFollow}
              disabled={busy}
              style={[styles.followButton, { borderColor: post.is_following_author ? c.borderActive : c.accent }]}
            >
              <Ionicons
                name={post.is_following_author ? 'person-remove-outline' : 'person-add-outline'}
                size={14}
                color={post.is_following_author ? c.textSecondary : c.accent}
              />
              <Text style={{ color: post.is_following_author ? c.textSecondary : c.accent, fontSize: 11, fontWeight: '800' }}>
                {post.is_following_author ? 'FOLLOWING' : 'FOLLOW'}
              </Text>
            </Pressable>
            <Pressable onPress={onReportPost} disabled={busy} style={[styles.visibilityBadge, { borderColor: c.borderSubtle }]}>
              <Ionicons name="flag-outline" size={13} color={c.textTertiary} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.ownerActions}>
            <View style={[styles.visibilityBadge, { borderColor: c.borderSubtle }]}>
              <Ionicons name={visibilityIcon(post.visibility)} size={13} color={c.textTertiary} />
            </View>
            <Pressable
              onPress={onDeletePost}
              disabled={busy}
              style={[styles.visibilityBadge, { borderColor: c.borderSubtle }]}
            >
              <Ionicons name="trash-outline" size={13} color={c.textTertiary} />
            </Pressable>
          </View>
        )}
      </View>

      {postImage ? (
        <Image
          source={{ uri: postImage }}
          style={[styles.postImage, { backgroundColor: c.elevated }]}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.previewGrid, { borderColor: c.borderSubtle }]}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={styles.gridRow}>
              {[0, 1, 2].map((col) => {
                const slot = row * 3 + col;
                const item = bySlot[slot];
                const meta = CATEGORY_META[item?.category || categoryForSlot(slot)];
                return (
                  <View
                    key={slot}
                    style={[
                      styles.previewSlot,
                      {
                        borderColor: item ? meta.color + '66' : c.borderSubtle,
                        backgroundColor: item ? meta.soft : c.bg,
                      },
                    ]}
                  >
                    <View style={[styles.previewAccent, { backgroundColor: meta.color }]} />
                    {item?.image ? (
                      <Image
                        source={{ uri: resolveApiAssetUrl(item.image) }}
                        style={styles.previewImage}
                        contentFit="contain"
                      />
                    ) : item ? (
                      <View style={styles.itemFallback}>
                        <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={18} color={meta.color} />
                        <Text numberOfLines={1} style={{ color: c.textTertiary, fontSize: 9, marginTop: 2 }}>
                          {item.name}
                        </Text>
                      </View>
                    ) : (
                      <Text style={{ color: c.textTertiary, fontSize: 9 }}>{slot + 1}</Text>
                    )}
                    <View style={[styles.previewBadge, { borderColor: meta.color, backgroundColor: c.bg }]}>
                      <Text style={{ color: meta.color, fontSize: 7, fontWeight: '900' }}>{meta.short}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}

      <View style={styles.feedActionRow}>
        <View style={styles.feedActionGroup}>
          <ActionButton
            icon={post.is_liked ? 'heart' : 'heart-outline'}
            label={String(post.likes_count)}
            active={post.is_liked}
            disabled={busy}
            onPress={onLike}
          />
          {challengeActive && (
            <ActionButton
              icon="trophy-outline"
              label="Vote"
              active={false}
              disabled={busy}
              onPress={onChallengeVote}
            />
          )}
          <StatPill icon="chatbubble-outline" label={String(post.comments_count)} />
        </View>
        <ActionButton
          icon={post.is_saved ? 'bookmark' : 'bookmark-outline'}
          label={String(post.saves_count)}
          active={post.is_saved}
          disabled={busy}
          onPress={onSave}
        />
      </View>

      <Text style={{ color: c.textPrimary, fontSize: 13, lineHeight: 19, marginTop: 10 }}>
        <Text style={{ fontWeight: '900' }}>{post.author_name} </Text>
        {post.caption || post.title}
      </Text>
      {post.caption ? (
        <Text style={{ color: c.textTertiary, fontSize: 12, marginTop: 4 }} numberOfLines={1}>
          {post.title}
        </Text>
      ) : null}

      <View style={styles.colorRow}>
        {swatches.map((color, index) => (
          <View key={`${color}-${index}`} style={[styles.swatch, { backgroundColor: color, borderColor: c.borderSubtle }]} />
        ))}
      </View>

      {post.latest_comments.length ? (
        <View style={[styles.commentsBox, { borderTopColor: c.borderSubtle }]}>
          {post.latest_comments.map((comment) => (
            <View key={comment.id} style={styles.commentLine}>
              <Text style={{ color: c.textSecondary, fontSize: 12, lineHeight: 18, flex: 1 }}>
                <Text style={{ color: c.textPrimary, fontWeight: '800' }}>{comment.user_name}: </Text>
                {comment.text}
              </Text>
              {(comment.user_id === currentUserId || isOwnPost) ? (
                <Pressable onPress={() => onDeleteComment(comment.id)} disabled={busy} hitSlop={8}>
                  <Ionicons name="close-outline" size={16} color={c.textTertiary} />
                </Pressable>
              ) : (
                <Pressable onPress={() => onReportComment(comment.id)} disabled={busy} hitSlop={8}>
                  <Ionicons name="flag-outline" size={14} color={c.textTertiary} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.commentInputRow}>
        <TextInput
          value={commentValue}
          onChangeText={onCommentChange}
          placeholder="Write a comment"
          placeholderTextColor={c.textTertiary}
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={onComment}
          style={[
            styles.commentInput,
            {
              borderColor: c.borderSubtle,
              backgroundColor: c.elevated,
              color: c.textPrimary,
            },
          ]}
        />
        <Pressable
          onPress={onComment}
          disabled={busy || !commentValue.trim()}
          style={[
            styles.sendButton,
            { backgroundColor: busy || !commentValue.trim() ? c.borderActive : c.accent },
          ]}
        >
          <Ionicons name="send-outline" size={16} color={c.bg} />
        </Pressable>
      </View>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  active,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionButton, { borderColor: active ? c.accent : c.borderSubtle }]}
    >
      <Ionicons name={icon} size={17} color={active ? c.accent : c.textSecondary} />
      <Text style={{ color: active ? c.accent : c.textSecondary, fontSize: 12, fontWeight: '800' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatPill({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.actionButton, { borderColor: c.borderSubtle }]}>
      <Ionicons name={icon} size={17} color={c.textSecondary} />
      <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '800' }}>
        {label}
      </Text>
    </View>
  );
}

function tripDaysLabel(trip: Trip) {
  const days = Math.max(
    1,
    Math.round((new Date(trip.end_date).getTime() - new Date(trip.start_date).getTime()) / 86400000) + 1
  );
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'P';
}

function visibilityIcon(visibility: CommunityPost['visibility']): keyof typeof Ionicons.glyphMap {
  if (visibility === 'followers') return 'people-outline';
  if (visibility === 'private') return 'lock-closed-outline';
  return 'globe-outline';
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  kicker: { fontSize: 11, letterSpacing: 1.5, fontWeight: '700' },
  h1: { fontSize: 34, fontWeight: '700', marginTop: 4 },
  iconBtn: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharePanel: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginTop: 20,
  },
  profileCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginTop: 18,
  },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileAvatar: {
    width: 54,
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileButton: {
    height: 34,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
  },
  profileStats: { flexDirection: 'row', marginTop: 14 },
  profileStat: { flex: 1, alignItems: 'center', gap: 2 },
  challengeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  challengeCard: { width: 260, borderWidth: 1, borderRadius: 8, padding: 14 },
  challengeIcon: { width: 38, height: 38, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  challengeStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  shareTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  captionInput: {
    minHeight: 72,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
    textAlignVertical: 'top',
  },
  visibilityRow: { gap: 8, paddingTop: 12 },
  visibilityChip: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  sharePreviewCard: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  sharePreviewHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  sharePreviewGrid: { flex: 1, borderWidth: 1, borderRadius: 10, overflow: 'hidden', marginTop: 12 },
  sharePreviewSlot: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    padding: 5,
  },
  sharePreviewImage: { width: '86%', height: '74%' },
  sharePreviewFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  shareButton: {
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  scopeChip: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  emptyState: { minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 24 },
  postCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
  },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followButton: {
    minWidth: 106,
    height: 34,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 8,
  },
  visibilityBadge: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerActions: { flexDirection: 'row', gap: 6 },
  previewGrid: { width: '100%', aspectRatio: 1, borderWidth: 1, borderRadius: 8, overflow: 'hidden', marginTop: 14 },
  gridRow: { flex: 1, flexDirection: 'row' },
  previewSlot: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  previewAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, zIndex: 2 },
  previewImage: { width: '100%', height: '100%' },
  previewBadge: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  itemFallback: { alignItems: 'center', justifyContent: 'center', padding: 4, width: '100%' },
  postImage: { width: '100%', aspectRatio: 4 / 5, borderRadius: 8, marginTop: 14 },
  colorRow: { flexDirection: 'row', gap: 6, marginTop: 12, minHeight: 16 },
  swatch: { width: 16, height: 16, borderRadius: 8, borderWidth: 1 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  feedActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  feedActionGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionButton: {
    height: 34,
    minWidth: 58,
    borderWidth: 0,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
  },
  commentsBox: { borderTopWidth: 1, paddingTop: 12, marginTop: 12, gap: 6 },
  commentLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  commentInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
