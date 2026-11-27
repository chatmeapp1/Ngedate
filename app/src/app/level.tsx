import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HostLevelBadge, LevelBadge, levelStyle } from '@/components/Badges';
import { Loading } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { number } from '@/lib/format';
import { radius } from '@/lib/theme';

const GOLD = '#FFD98A';

// Layar "Tingkat saya": daftar level 0-10 dan kemajuan menuju level berikutnya (dari total top up koin)
export default function LevelScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshMe } = useAuth();
  useFocusEffect(
    useCallback(() => {
      refreshMe();
    }, [refreshMe])
  );
  const m = user?.membership;
  if (!user || !m) return <Loading />;
  const next = m.nextLevelAt;
  const isHost = m.kind === 'host';
  const unit = isHost ? '💎' : 'koin';

  return (
    <View style={{ flex: 1, backgroundColor: '#17121F' }}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Text style={s.title}>{isHost ? 'Level host' : 'Tingkat saya'}</Text>
        <View style={s.back} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130, gap: 10 }}>
        <LinearGradient colors={['#4B3575', '#2B2040']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          {isHost ? <HostLevelBadge level={m.level} size={26} /> : <LevelBadge level={m.level} size={34} />}
          <Text style={s.heroText}>
            {next === null
              ? 'Kamu sudah di tingkat tertinggi 👑'
              : isHost
                ? `Dapatkan ${number(next - m.topupTotal)} 💎 lagi untuk naik ke Lv ${m.level + 1}`
                : `Top up ${number(next - m.topupTotal)} koin lagi untuk naik ke Lv ${m.level + 1}`}
          </Text>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.round(m.levelProgress * 100)}%` }]} />
          </View>
          <Text style={s.heroSub}>{isHost ? `Penghasilan 7 hari terakhir: ${number(m.topupTotal)} 💎` : `Total top up: ${number(m.topupTotal)} koin`}</Text>
        </LinearGradient>

        <Text style={s.hint}>{isHost ? 'Level host dibagi berdasarkan total penghasilan diamond dalam 7 hari terakhir (bergulir). Menarik diamond tidak menurunkan level.' : 'Level naik otomatis dari total koin yang kamu top up dan tidak turun.'}</Text>

        {m.levelThresholds.map((need, level) => {
          const reached = m.level >= level;
          const current = m.level === level;
          const st = levelStyle(level);
          return (
            <View key={level} style={[s.row, current && { borderColor: st.ring, borderWidth: 1.5 }, !reached && { opacity: 0.55 }]}>
              <View style={{ width: 96 }}>
                {isHost ? <HostLevelBadge level={level} size={22} /> : <LevelBadge level={level} size={28} />}
              </View>
              <Text style={s.need}>
                {number(need)} <Text style={{ fontSize: 13, color: GOLD }}>{unit}</Text>
              </Text>
              {current ? <Text style={[s.now, { color: st.ring }]}>Sekarang</Text> : reached ? <Ionicons name="checkmark-circle" size={20} color="#4ADE9F" /> : <Ionicons name="lock-closed" size={16} color="#8E86A0" />}
            </View>
          );
        })}
      </ScrollView>

      <View style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.who} numberOfLines={1}>
            {user.displayName}
          </Text>
          <Text style={s.id}>ID {user.id}</Text>
        </View>
        {isHost ? null : (
          <Pressable onPress={() => router.push('/topup')} style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}>
            <Text style={s.ctaText}>Top up</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10 },
  back: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: '800' },
  hero: { borderRadius: radius.lg, padding: 18, gap: 12 },
  heroText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  heroSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: GOLD },
  hint: { color: '#A79DB5', fontSize: 12, textAlign: 'center', marginVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#241C33', borderRadius: radius.md, paddingHorizontal: 16, height: 66, borderWidth: 1.5, borderColor: 'transparent' },
  need: { flex: 1, color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  now: { fontSize: 12, fontWeight: '800', width: 62, textAlign: 'right' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 14, backgroundColor: '#241C33' },
  who: { color: GOLD, fontSize: 18, fontWeight: '800' },
  id: { color: '#A79DB5', fontSize: 13, marginTop: 2 },
  cta: { backgroundColor: GOLD, borderRadius: radius.pill, paddingHorizontal: 34, height: 46, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#5B3A00', fontSize: 16, fontWeight: '900' },
});
