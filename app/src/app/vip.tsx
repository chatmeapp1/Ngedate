import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VipBadge, vipColors } from '@/components/Badges';
import { Loading } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { number } from '@/lib/format';
import { radius } from '@/lib/theme';

const GOLD = '#FFD98A';

// Layar VIP: tingkat VIP 1-5 dari total top up, beserta keuntungannya
export default function VipScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshMe } = useAuth();
  useFocusEffect(
    useCallback(() => {
      refreshMe();
    }, [refreshMe])
  );
  const m = user?.membership;
  if (!user || !m) return <Loading />;
  const perks: { icon: string; text: string; soon?: boolean }[] = [
    { icon: 'message-fast-outline', text: `${m.freeCardsPerDay} kartu pesan gratis per hari (host tetap dibayar)` },
    { icon: 'image-multiple-outline', text: 'Kirim foto di chat', soon: true },
    { icon: 'video-outline', text: 'Kirim video di chat', soon: true },
    { icon: 'crown-outline', text: 'Lencana VIP di profil' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#17121F' }}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Text style={s.title}>VIP</Text>
        <View style={s.back} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130, gap: 12 }}>
        <LinearGradient colors={m.vip > 0 ? vipColors(m.vip) : ['#4B3575', '#2B2040']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <MaterialCommunityIcons name="crown" size={44} color="#fff" />
          <Text style={s.heroTitle}>{m.vip > 0 ? `VIP ${m.vip}` : 'Belum VIP'}</Text>
          <Text style={s.heroText}>
            {m.nextVipAt === null
              ? 'Kamu sudah di VIP tertinggi'
              : `Top up ${number(m.nextVipAt - m.topupTotal)} koin lagi untuk ${m.vip > 0 ? `VIP ${m.vip + 1}` : 'jadi VIP 1'}`}
          </Text>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.round(m.vipProgress * 100)}%` }]} />
          </View>
          {m.vip > 0 ? (
            <Text style={s.heroSub}>
              Kartu gratis hari ini: {m.freeCardsLeft} dari {m.freeCardsPerDay}
            </Text>
          ) : (
            <Text style={s.heroSub}>Total top up: {number(m.topupTotal)} koin</Text>
          )}
        </LinearGradient>

        <Text style={s.section}>Keuntungan VIP</Text>
        <View style={s.card}>
          {perks.map((p) => (
            <View key={p.text} style={s.perk}>
              <MaterialCommunityIcons name={p.icon as any} size={22} color={GOLD} />
              <Text style={s.perkText}>{p.text}</Text>
              {p.soon ? <Text style={s.soon}>Segera</Text> : null}
            </View>
          ))}
        </View>

        <Text style={s.section}>Tingkat VIP</Text>
        {m.vipThresholds.map((need, i) => {
          const vip = i + 1;
          const reached = m.vip >= vip;
          return (
            <View key={vip} style={[s.row, !reached && { opacity: 0.6 }]}>
              <VipBadge vip={vip} size={26} />
              <Text style={s.need}>
                {number(need)} <Text style={{ fontSize: 13, color: GOLD }}>koin</Text>
              </Text>
              {reached ? <Ionicons name="checkmark-circle" size={20} color="#4ADE9F" /> : <Ionicons name="lock-closed" size={16} color="#8E86A0" />}
            </View>
          );
        })}
        <Text style={s.hint}>VIP dihitung dari total koin yang kamu top up dan berlaku seterusnya.</Text>
      </ScrollView>

      <View style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable onPress={() => router.push('/topup')} style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}>
          <Text style={s.ctaText}>Top up untuk naik VIP</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10 },
  back: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: '800' },
  hero: { borderRadius: radius.lg, padding: 20, gap: 10, alignItems: 'center' },
  heroTitle: { color: '#fff', fontSize: 30, fontWeight: '900' },
  heroText: { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  track: { alignSelf: 'stretch', height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: '#fff' },
  section: { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 6 },
  card: { backgroundColor: '#241C33', borderRadius: radius.md, padding: 6 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, height: 50 },
  perkText: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '600' },
  soon: { color: '#17121F', backgroundColor: GOLD, fontSize: 10, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#241C33', borderRadius: radius.md, paddingHorizontal: 16, height: 58 },
  need: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'right' },
  hint: { color: '#A79DB5', fontSize: 12, textAlign: 'center', marginTop: 4 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, backgroundColor: '#241C33' },
  cta: { backgroundColor: GOLD, borderRadius: radius.pill, height: 48, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#5B3A00', fontSize: 16, fontWeight: '900' },
});
