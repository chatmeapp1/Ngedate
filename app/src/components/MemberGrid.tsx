import { router } from 'expo-router';
import { memo, type ReactElement } from 'react';
import { StyleSheet, Text, View, Pressable, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Avatar, Empty } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { countryName, flag } from '@/lib/countries';
import { openChatWithMember } from '@/lib/openChat';
import { usePresence } from '@/lib/usePresence';
import { colors, gradients, radius } from '@/lib/theme';
import type { User } from '@/lib/types';

// Kartu pengguna pria (dilihat oleh host): foto, nama, usia, negara, status online
const MemberCard = memo(function MemberCard({ member, online, onPress }: { member: User; online?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.98 }] }]}>
      {member.avatarUrl ? (
        <Image source={{ uri: member.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : (
        <LinearGradient colors={gradients.soft} style={[StyleSheet.absoluteFill, s.placeholder]}>
          <Avatar name={member.displayName} size={72} />
        </LinearGradient>
      )}
      <LinearGradient colors={gradients.photoFade} style={s.fade} />

      <View style={s.top}>
        {/* Status: bulat hijau = online, abu-abu = offline */}
        <View style={[s.statusDot, { backgroundColor: (online ?? member.online) ? colors.online : '#9CA3AF' }]} />
        {member.countryCode ? (
          <View style={s.country}>
            <Text style={{ fontSize: 13 }}>{flag(member.countryCode)}</Text>
            <Text style={s.countryText} numberOfLines={1}>
              {countryName(member.countryCode)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={s.bottom}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[s.name, { flexShrink: 1 }]} numberOfLines={1}>
            {member.displayName}
            {member.age ? <Text style={s.age}>  {member.age}</Text> : null}
          </Text>
          {member.verified ? <Verified size={15} /> : null}
        </View>
        <Pressable onPress={() => openChatWithMember(member.id)} hitSlop={8}>
          <LinearGradient colors={gradients.brand} style={s.msgBtn}>
            <Ionicons name="chatbubble-ellipses" size={20} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>
    </Pressable>
  );
});

// Grid 2 kolom pengguna pria, dipakai di Beranda & pencarian akun host
export function MemberGrid({
  members,
  loading,
  refreshing,
  error,
  onRefresh,
  onEndReached,
  header,
  emptyText = 'Belum ada pengguna',
}: {
  members: User[];
  loading: boolean;
  refreshing: boolean;
  error?: string | null;
  onRefresh: () => void;
  onEndReached: () => void;
  header?: ReactElement;
  emptyText?: string;
}) {
  const presence = usePresence(members.map((m) => m.id));
  return (
    <FlatList
      data={members}
      keyExtractor={(m) => String(m.id)}
      numColumns={2}
      columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
      contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
      ListHeaderComponent={header}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      renderItem={({ item }) => (
        <MemberCard member={item} online={presence[item.id]} onPress={() => router.push({ pathname: '/member/[id]', params: { id: String(item.id) } })} />
      )}
      ListEmptyComponent={
        loading ? null : error ? (
          <Empty icon="cloud-offline-outline" title={error} subtitle="Tarik ke bawah untuk mencoba lagi" />
        ) : (
          <Empty icon="people-outline" title={emptyText} />
        )
      }
      ListFooterComponent={
        loading ? (
          <View style={{ paddingVertical: 20 }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null
      }
    />
  );
}

const s = StyleSheet.create({
  card: { flex: 1, aspectRatio: 0.78, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, gap: 6 },
  statusDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  online: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    height: 24,
    borderRadius: radius.pill,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.online },
  onlineText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  country: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    height: 24,
    borderRadius: radius.pill,
    maxWidth: '62%',
  },
  countryText: { color: '#fff', fontSize: 11, fontWeight: '700', flexShrink: 1 },
  bottom: { position: 'absolute', left: 12, right: 10, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  msgBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  name: { color: '#fff', fontSize: 14, fontWeight: '600' },
  age: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.85)' },
});
