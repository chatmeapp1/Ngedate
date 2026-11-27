import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LevelBadge, VipBadge } from '@/components/Badges';
import { FramedAvatar } from '@/components/FramedAvatar';
import { SafetyMenu } from '@/components/SafetyMenu';
import { Avatar, Empty, GradientButton, Loading } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { api, errorMessage } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { lastSeen } from '@/lib/format';
import { openChatWithMember } from '@/lib/openChat';
import { colors, gradients, radius } from '@/lib/theme';
import type { Member } from '@/lib/types';

// Profil pengguna pria — hanya dilihat oleh akun host. Host boleh menyapa duluan (gratis).
export default function MemberProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [member, setMember] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Member>(`/api/members/${id}`)
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
        <View style={[s.menuFloat, { top: insets.top + 8 }]}>
          <SafetyMenu light userId={member.id} name={member.displayName} onBlocked={() => router.back()} />
        </View>
        <View style={s.info}>
          <View style={{ alignSelf: 'flex-start' }}>
            <FramedAvatar uri={member.avatarUrl} name={member.displayName} size={40} vip={member.vip ?? 0} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={s.name} numberOfLines={1}>
              {member.displayName}
              {member.age ? <Text style={s.age}>  {member.age}</Text> : null}
            </Text>
            {member.verified ? <Verified size={17} /> : null}
            {member.level != null ? <LevelBadge level={member.level} size={19} style={{ alignSelf: 'center' }} /> : null}
            {member.vip ? <VipBadge vip={member.vip} size={18} /> : null}
          </View>
          <View style={s.chips}>
            <View style={s.chip}>
              <Text style={{ fontSize: 13 }}>{member.countryCode ? flag(member.countryCode) : '🌐'}</Text>
              <Text style={s.chipText}>{member.countryCode ? countryName(member.countryCode) : 'Negara belum diisi'}</Text>
            </View>
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
          <Text style={s.noteText}>Sapaanmu gratis. Kalau pengguna membalas, koin mereka ditahan dan masuk ke kamu setelah kamu membalas lagi.</Text>
        </View>
      </View>
      <View style={[s.cta, { paddingBottom: insets.bottom + 12 }]}>
        <GradientButton title="Sapa sekarang · Gratis" icon="chatbubble-ellipses" onPress={() => openChatWithMember(member.id)} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  back: { padding: 12 },
  cover: { height: 380, backgroundColor: colors.surfaceAlt },
  center: { alignItems: 'center', justifyContent: 'center' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  menuFloat: { position: 'absolute', right: 14 },
  backFloat: { position: 'absolute', left: 14, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  info: { position: 'absolute', left: 16, right: 16, bottom: 16, gap: 8 },
  name: { color: '#fff', fontSize: 21, fontWeight: '600', flexShrink: 1 },
  age: { fontSize: 16, fontWeight: '500', color: 'rgba(255,255,255,0.85)' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 10, height: 26, borderRadius: radius.pill },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { padding: 16, gap: 14 },
  bio: { fontSize: 15, color: colors.text, lineHeight: 22 },
  bioEmpty: { fontSize: 14, color: colors.textDim },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  tagText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13 },
  cta: { position: 'absolute', left: 16, right: 16, bottom: 0 },
  note: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: '#F3E8FF', alignItems: 'flex-start' },
  noteText: { flex: 1, color: colors.textSub, fontSize: 13, lineHeight: 18 },
});
