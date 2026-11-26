import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GiftIcon } from '@/components/GiftIcon';
import { GiftSheet } from '@/components/GiftSheet';
import { SafetyMenu } from '@/components/SafetyMenu';
import { Avatar, Coin, Empty, Loading } from '@/components/ui';
import { HostLevelBadge } from '@/components/Badges';
import { Verified } from '@/components/Verified';
import { useAuth } from '@/context/auth';
import { api, errorMessage } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { compact, lastSeen, number, replyTime } from '@/lib/format';
import { openChat } from '@/lib/openChat';
import { colors, gradients, radius } from '@/lib/theme';
import type { Conversation, GiftWall, HostProfile } from '@/lib/types';

export default function HostProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const [host, setHost] = useState<HostProfile | null>(null);
  const [wall, setWall] = useState<GiftWall | null>(null);
  const [tab, setTab] = useState<'album' | 'gifts'>('album');
  const [viewer, setViewer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);

  const load = useCallback(() => {
    api.get<HostProfile>(`/api/hosts/${id}`).then(setHost).catch((e) => setError(errorMessage(e)));
    api.get<GiftWall>(`/api/hosts/${id}/gifts`).then(setWall).catch(() => {});
  }, [id]);

  useFocusEffect(load);

  // Gift dari profil: buat percakapan dulu jika belum ada
  const getConvId = useCallback(async () => {
    const conv = await api.post<Conversation>('/api/conversations', { hostId: Number(id) });
    return conv.id;
  }, [id]);

  if (!host) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        {error ? <Empty icon="alert-circle-outline" title={error} /> : <Loading />}
      </View>
    );
  }

  const isSelf = user?.id === host.id;
  const cover = host.avatarUrl ?? host.photos[0]?.url ?? null;
  const giftTotal = host.conversation?.giftTotal ?? 0;
  const threshold = host.waUnlockThreshold ?? 0;
  const waUnlocked = host.conversation?.waUnlocked ?? false;
  const progress = threshold > 0 ? Math.min(1, giftTotal / threshold) : 0;
  const reply = replyTime(host.avgReplyMinutes);

  const toggle = async (kind: 'follow' | 'like') => {
    Haptics.selectionAsync().catch(() => {});
    const on = kind === 'follow' ? host.isFollowing : host.isLiked;
    // Ubah tampilan dulu supaya terasa cepat, lalu sesuaikan dengan jawaban server
    setHost({
      ...host,
      ...(kind === 'follow'
        ? { isFollowing: !on, followers: host.followers + (on ? -1 : 1) }
        : { isLiked: !on, likes: host.likes + (on ? -1 : 1) }),
    });
    try {
      const path = `/api/users/${host.id}/${kind}`;
      const r = on
        ? await api.del<{ followers: number; likes: number }>(path)
        : await api.post<{ followers: number; likes: number }>(path);
      setHost((h) => (h ? { ...h, followers: r.followers, likes: r.likes } : h));
    } catch (e) {
      load();
      Alert.alert('Gagal', errorMessage(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}>
        {/* Foto utama */}
        <View style={{ width, height: width * 1.05 }}>
          {cover ? (
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setViewer(cover)}>
              <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </Pressable>
          ) : (
            <LinearGradient colors={gradients.soft} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
              <Avatar name={host.displayName} size={120} />
            </LinearGradient>
          )}
          <LinearGradient colors={gradients.photoFade} style={s.coverFade} pointerEvents="none" />

          <View style={[s.topBar, { top: insets.top + 6 }]}>
            <Pressable onPress={() => router.back()} style={s.roundBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </Pressable>
            {!isSelf ? <SafetyMenu light userId={host.id} name={host.displayName} onBlocked={() => router.back()} /> : null}
          </View>

          <View style={s.identity}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[s.name, { flexShrink: 1 }]} numberOfLines={1}>
                  {host.displayName}
                </Text>
                {host.verified ? <Verified size={22} /> : null}
                {host.level != null ? <HostLevelBadge level={host.level} size={18} /> : null}
              </View>
              <View style={s.badges}>
                {host.age ? (
                  <View style={[s.badge, { backgroundColor: host.gender === 'male' ? '#3B82F6' : colors.pink }]}>
                    <Ionicons name={host.gender === 'male' ? 'male' : 'female'} size={12} color="#fff" />
                    <Text style={s.badgeText}>{host.age}</Text>
                  </View>
                ) : null}
                {host.countryCode ? (
                  <View style={s.badge}>
                    <Text style={{ fontSize: 12 }}>{flag(host.countryCode)}</Text>
                    <Text style={s.badgeText}>{countryName(host.countryCode)}</Text>
                  </View>
                ) : null}
                <View style={s.badge}>
                  <Text style={s.badgeText}>ID {host.id}</Text>
                </View>
              </View>
              <View style={s.statusRow}>
                <View style={[s.dot, { backgroundColor: host.online ? colors.online : colors.textDim }]} />
                <Text style={s.statusText}>{lastSeen(host.lastSeenAt, host.online)}</Text>
                {reply ? <Text style={s.statusText}> · {reply}</Text> : null}
              </View>
            </View>
            {!isSelf ? (
              <Pressable onPress={() => toggle('follow')}>
                {host.isFollowing ? (
                  <View style={[s.followBtn, { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                    <Ionicons name="checkmark" size={22} color="#fff" />
                    <Text style={s.followText}>Diikuti</Text>
                  </View>
                ) : (
                  <LinearGradient colors={gradients.brand} style={s.followBtn}>
                    <Ionicons name="person-add" size={20} color="#fff" />
                    <Text style={s.followText}>Ikuti</Text>
                  </LinearGradient>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>

        {host.bio ? <Text style={s.bio}>{host.bio}</Text> : null}
        {host.tags.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingTop: 10 }}>
            {host.tags.map((t) => (
              <View key={t} style={{ paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: '#F3E8FF', justifyContent: 'center' }}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>#{t}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Statistik */}
        <View style={s.stats}>
          <Stat value={host.following} label="Mengikuti" />
          <View style={s.divider} />
          <Stat value={host.followers} label="Pengikut" />
          <View style={s.divider} />
          <Stat value={host.likes} label="Disukai" />
        </View>

        {/* Buka WhatsApp */}
        {host.waAvailable && !isSelf ? (
          <LinearGradient colors={['#ECFDF5', '#F0FDF4']} style={s.waCard}>
            <View style={s.waIcon}>
              <Ionicons name={waUnlocked ? 'logo-whatsapp' : 'lock-closed'} size={22} color="#fff" />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={s.waTitle}>{waUnlocked ? 'WhatsApp sudah terbuka 🎉' : 'Buka nomor WhatsApp'}</Text>
              {waUnlocked ? (
                <Text style={s.waSub}>Lihat nomornya di halaman chat.</Text>
              ) : (
                <>
                  <View style={s.track}>
                    <LinearGradient colors={['#22C55E', '#16A34A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.fill, { width: `${progress * 100}%` }]} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Coin size={13} />
                    <Text style={s.waSub}>
                      {compact(giftTotal)} / {compact(threshold)} koin gift
                    </Text>
                  </View>
                </>
              )}
            </View>
          </LinearGradient>
        ) : null}

        {/* Tab album / dinding hadiah */}
        <View style={s.tabs}>
          {(
            [
              ['album', `Album (${host.photos.length})`],
              ['gifts', 'Dinding hadiah'],
            ] as const
          ).map(([key, label]) => (
            <Pressable key={key} onPress={() => setTab(key)} style={s.tab}>
              <Text style={[s.tabText, tab === key && s.tabTextOn]}>{label}</Text>
              {tab === key ? <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.tabLine} /> : null}
            </Pressable>
          ))}
        </View>

        {tab === 'album' ? (
          host.photos.length ? (
            <View style={s.album}>
              {host.photos.map((p) => (
                <Pressable key={p.id} style={s.albumCell} onPress={() => setViewer(p.url)}>
                  <Image source={{ uri: p.url }} style={s.albumImg} contentFit="cover" transition={120} />
                </Pressable>
              ))}
            </View>
          ) : (
            <Empty icon="images-outline" title="Belum ada foto" />
          )
        ) : wall && (wall.gifts.length || wall.topSenders.length) ? (
          <View style={{ paddingHorizontal: 16, gap: 16 }}>
            <View style={s.giftGrid}>
              {wall.gifts.map((g) => (
                <View key={g.id} style={s.giftCell}>
                  <GiftIcon icon={g.icon} imageUrl={g.imageUrl} size={40} />
                  <Text style={s.giftName} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Text style={s.giftCount}>x{number(g.count)}</Text>
                </View>
              ))}
            </View>
            {wall.topSenders.length ? (
              <View style={{ gap: 10 }}>
                <Text style={s.sectionTitle}>Pengirim terbesar</Text>
                {wall.topSenders.map((t, i) => (
                  <View key={t.user.id} style={s.sender}>
                    <Text style={[s.rank, i < 3 && { color: [colors.gold, '#A3A3A3', '#D97706'][i] }]}>{i + 1}</Text>
                    <Avatar uri={t.user.avatarUrl} name={t.user.displayName} size={36} />
                    <Text style={s.senderName} numberOfLines={1}>
                      {t.user.displayName}
                    </Text>
                    <Coin size={14} />
                    <Text style={s.senderTotal}>{compact(t.total)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <Empty icon="gift-outline" title="Belum ada hadiah" subtitle="Jadilah yang pertama mengirim gift" />
        )}
      </ScrollView>

      {/* Tombol aksi bawah */}
      {!isSelf ? (
        <View style={[s.actions, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={() => toggle('like')} style={[s.circle, { backgroundColor: host.isLiked ? colors.pink : '#FFE4EF' }]}>
            <Ionicons name={host.isLiked ? 'heart' : 'heart-outline'} size={26} color={host.isLiked ? '#fff' : colors.pink} />
          </Pressable>
          {user?.role === 'user' ? (
            <Pressable onPress={() => setGiftOpen(true)} style={[s.circle, { backgroundColor: '#FFF1DB' }]}>
              <Ionicons name="gift" size={24} color="#F59E0B" />
            </Pressable>
          ) : null}
          <Pressable style={{ flex: 1 }} onPress={() => openChat(host.id)}>
            <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.msgBtn}>
              <Ionicons name="chatbubble-ellipses" size={22} color="#fff" />
              <View>
                <Text style={s.msgTitle}>Kirim Pesan</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {host.chatPrice > 0 ? (
                    <>
                      <Coin size={13} />
                      <Text style={s.msgPrice}>{number(host.chatPrice)} / pesan</Text>
                    </>
                  ) : (
                    <Text style={s.msgPrice}>Gratis</Text>
                  )}
                </View>
              </View>
            </LinearGradient>
          </Pressable>
        </View>
      ) : null}

      {/* Lihat foto layar penuh */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={s.viewer} onPress={() => setViewer(null)}>
          {viewer ? <Image source={{ uri: viewer }} style={{ width: '100%', height: '80%' }} contentFit="contain" /> : null}
        </Pressable>
      </Modal>

      {user?.role === 'user' && !isSelf ? (
        <GiftSheet
          visible={giftOpen}
          onClose={() => setGiftOpen(false)}
          getConversationId={getConvId}
          hostName={host.displayName}
          onSent={() => load()}
        />
      ) : null}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={s.statValue}>{compact(value)}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  coverFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  topBar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  identity: { position: 'absolute', left: 16, right: 16, bottom: 18, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  name: { color: '#fff', fontSize: 28, fontWeight: '900' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600' },
  followBtn: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 2 },
  followText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  bio: { color: colors.textSub, fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingTop: 14 },
  stats: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18, marginHorizontal: 16, borderBottomWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 22, fontWeight: '900', color: colors.text },
  statLabel: { fontSize: 12, color: colors.textSub, marginTop: 2 },
  divider: { width: 1, height: 28, backgroundColor: colors.border },
  waCard: { flexDirection: 'row', alignItems: 'center', gap: 12, margin: 16, marginBottom: 4, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: '#BBF7D0' },
  waIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center' },
  waTitle: { fontWeight: '800', color: '#14532D', fontSize: 15 },
  waSub: { color: '#166534', fontSize: 12, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#DCFCE7', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  tabs: { flexDirection: 'row', gap: 28, paddingHorizontal: 16, marginTop: 16, marginBottom: 12, borderBottomWidth: 1, borderColor: colors.border },
  tab: { paddingVertical: 10 },
  tabText: { fontSize: 16, fontWeight: '700', color: colors.textDim },
  tabTextOn: { color: colors.text },
  tabLine: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 3, borderRadius: 2 },
  album: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  albumCell: { width: '50%', padding: 4 },
  albumImg: { width: '100%', aspectRatio: 0.8, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  giftCell: { width: '22.5%', alignItems: 'center', padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, gap: 2 },
  giftName: { fontSize: 11, color: colors.textSub, fontWeight: '600' },
  giftCount: { fontSize: 12, color: colors.primary, fontWeight: '800' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  sender: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, padding: 10, borderRadius: radius.md },
  rank: { width: 20, textAlign: 'center', fontWeight: '900', color: colors.textDim },
  senderName: { flex: 1, fontWeight: '700', color: colors.text },
  senderTotal: { fontWeight: '800', color: colors.text },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(255,247,251,0.96)',
  },
  circle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  msgBtn: { height: 58, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  msgTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  msgPrice: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '700' },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
});
