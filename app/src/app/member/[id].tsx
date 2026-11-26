import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Empty, Loading } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { api, errorMessage } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { lastSeen } from '@/lib/format';
import { colors, gradients, radius } from '@/lib/theme';
import type { User } from '@/lib/types';

// Profil pengguna pria — hanya dilihat oleh akun host (tanpa tombol chat: host membalas saat user menulis)
export default function MemberProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [member, setMember] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<User>(`/api/members/${id}`)
      .then(setMember)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  if (!member) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={s.back}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        {error ? <Empty icon="alert-circle-outline" title={error} /> : <Loading />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={s.cover}>
        {member.avatarUrl ? (
          <Image source={{ uri: member.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <LinearGradient colors={gradients.soft} style={[StyleSheet.absoluteFill, s.center]}>
            <Avatar name={member.displayName} size={110} />
          </LinearGradient>
        )}
        <LinearGradient colors={gradients.photoFade} style={s.fade} />
        <Pressable hitSlop={10} onPress={() => router.back()} style={[s.backFloat, { top: insets.top + 8 }]}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <View style={s.info}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={s.name} numberOfLines={1}>
              {member.displayName}
              {member.age ? <Text style={s.age}>  {member.age}</Text> : null}
            </Text>
            {member.verified ? <Verified size={20} /> : null}
          </View>
          <View style={s.chips}>
            {member.countryCode ? (
              <View style={s.chip}>
                <Text style={{ fontSize: 13 }}>{flag(member.countryCode)}</Text>
                <Text style={s.chipText}>{countryName(member.countryCode)}</Text>
              </View>
            ) : null}
            <View style={s.chip}>
              <View style={[s.dot, { backgroundColor: member.online ? colors.online : colors.textDim }]} />
              <Text style={s.chipText}>{lastSeen(member.lastSeenAt, member.online)}</Text>
            </View>
            <View style={s.chip}>
              <Text style={s.chipText}>ID {member.id}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={s.body}>
        {member.bio ? <Text style={s.bio}>{member.bio}</Text> : <Text style={s.bioEmpty}>Belum ada bio</Text>}
        {member.tags?.length ? (
          <View style={s.tags}>
            {member.tags.map((t) => (
              <View key={t} style={s.tag}>
                <Text style={s.tagText}>{t}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={s.note}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={s.noteText}>Pengguna memulai obrolan sendiri. Pesannya akan muncul di tab Pesan, dan koin dibayarkan saat kamu membalas.</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  back: { padding: 12 },
  cover: { height: 380, backgroundColor: colors.surfaceAlt },
  center: { alignItems: 'center', justifyContent: 'center' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  backFloat: { position: 'absolute', left: 14, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  info: { position: 'absolute', left: 16, right: 16, bottom: 16, gap: 8 },
  name: { color: '#fff', fontSize: 28, fontWeight: '900', flexShrink: 1 },
  age: { fontSize: 20, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 10, height: 26, borderRadius: radius.pill },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { padding: 16, gap: 14 },
  bio: { fontSize: 15, color: colors.text, lineHeight: 22 },
  bioEmpty: { fontSize: 14, color: colors.textDim },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  tagText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13 },
  note: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: '#F3E8FF', alignItems: 'flex-start' },
  noteText: { flex: 1, color: colors.textSub, fontSize: 13, lineHeight: 18 },
});
