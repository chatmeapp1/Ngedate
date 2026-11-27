import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Coin } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { api } from '@/lib/api';
import { number } from '@/lib/format';
import { radius } from '@/lib/theme';

type Kind = 'hosts' | 'senders';
type Period = 'week' | 'all';
interface Entry {
  rank: number;
  id: number;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  countryCode: string | null;
  score: number;
}

const GOLD = '#F5D78A';
const RING = ['#F5D78A', '#C9D2E3', '#D9A066']; // emas, perak, perunggu
const MEDAL_BG = ['#FBE7A8', '#E2E8F3', '#F0C99A'];

function Score({ kind, value, size = 14 }: { kind: Kind; value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {kind === 'hosts' ? <Text style={{ fontSize: size }}>💎</Text> : <Coin size={size + 1} />}
      <Text style={[s.score, { fontSize: size }]}>{number(value)}</Text>
    </View>
  );
}

function PodiumSlot({ e, place, kind, onOpen }: { e?: Entry; place: 0 | 1 | 2; kind: Kind; onOpen: (e: Entry) => void }) {
  const first = place === 0;
  const size = first ? 84 : 64;
  if (!e) return <View style={{ flex: 1 }} />;
  return (
    <Pressable style={[s.slot, first && { marginTop: 0 }, !first && { marginTop: 26 }]} onPress={() => onOpen(e)}>
      {first ? <MaterialCommunityIcons name="crown" size={30} color={GOLD} style={{ marginBottom: -6 }} /> : null}
      <View style={[s.ring, { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, borderColor: RING[place] }]}>
        <Avatar uri={e.avatarUrl} name={e.displayName} size={size} />
        <View style={[s.medal, { backgroundColor: MEDAL_BG[place] }]}>
          <Text style={s.medalText}>{place + 1}</Text>
        </View>
      </View>
      <View style={s.nameRow}>
        <Text style={[s.podName, first && { fontSize: 14 }]} numberOfLines={1}>
          {e.displayName}
        </Text>
        {e.verified ? <Verified size={12} /> : null}
      </View>
      <Score kind={kind} value={e.score} size={first ? 14 : 12} />
    </Pressable>
  );
}

// Papan peringkat: host berpenghasilan terbanyak & pengirim gift terbanyak
export default function Rankings() {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<Kind>('hosts');
  const [period, setPeriod] = useState<Period>('week');
  const [items, setItems] = useState<Entry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: Entry[] }>(`/api/rankings?type=${kind}&period=${period}`);
      setItems(r.items);
    } catch {
      setItems([]);
    }
  }, [kind, period]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  const open = (e: Entry) => {
    if (kind === 'hosts') router.push({ pathname: '/host/[id]', params: { id: String(e.id) } });
  };
  const top = items?.slice(0, 3) ?? [];
  const rest = items?.slice(3) ?? [];

  return (
    <LinearGradient colors={['#2A1260', '#170A38', '#0E0724']} style={{ flex: 1 }}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Text style={s.title}>Papan peringkat</Text>
        <View style={s.back} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={GOLD}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {/* Judul */}
        <View style={s.hero}>
          <View style={s.glow}>
            <View style={s.glowInner}>
              <MaterialCommunityIcons name="trophy" size={64} color={GOLD} />
            </View>
          </View>
          <Text style={s.heroTitle}>Top Rank</Text>
          <Text style={s.heroSub}>{kind === 'hosts' ? 'Host dengan penghasilan terbanyak' : 'Pengirim gift terbanyak'}</Text>
        </View>

        {/* Pilihan */}
        <View style={s.seg}>
          {(
            [
              ['hosts', 'Host teratas'],
              ['senders', 'Pengirim teratas'],
            ] as const
          ).map(([k, label]) => (
            <Pressable key={k} onPress={() => setKind(k)} style={[s.segItem, kind === k && s.segOn]}>
              <Text style={[s.segText, kind === k && s.segTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.periods}>
          {(
            [
              ['week', '7 hari terakhir'],
              ['all', 'Semua waktu'],
            ] as const
          ).map(([p, label]) => (
            <Pressable key={p} onPress={() => setPeriod(p)} style={[s.period, period === p && s.periodOn]}>
              <Text style={[s.periodText, period === p && { color: '#2A1260' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {items === null ? (
          <ActivityIndicator color={GOLD} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <Text style={s.empty}>Belum ada data peringkat</Text>
        ) : (
          <>
            {/* Podium 3 teratas */}
            <View style={s.podium}>
              <LinearGradient colors={['rgba(124,77,255,0.35)', 'rgba(60,24,120,0.25)']} style={s.podiumBg}>
                <PodiumSlot e={top[1]} place={1} kind={kind} onOpen={open} />
                <PodiumSlot e={top[0]} place={0} kind={kind} onOpen={open} />
                <PodiumSlot e={top[2]} place={2} kind={kind} onOpen={open} />
              </LinearGradient>
            </View>

            {/* Peringkat 4 dst */}
            <View style={s.list}>
              {rest.map((e) => (
                <Pressable key={e.id} style={s.row} onPress={() => open(e)}>
                  <Text style={s.rank}>{e.rank}</Text>
                  <Avatar uri={e.avatarUrl} name={e.displayName} size={44} />
                  <View style={s.nameRow2}>
                    <Text style={s.rowName} numberOfLines={1}>
                      {e.displayName}
                    </Text>
                    {e.verified ? <Verified size={13} /> : null}
                  </View>
                  <Score kind={kind} value={e.score} />
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6 },
  back: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: '700' },
  hero: { alignItems: 'center', paddingTop: 6 },
  glow: { width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(245,215,138,0.08)', alignItems: 'center', justifyContent: 'center' },
  glowInner: { width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(245,215,138,0.14)', borderWidth: 1, borderColor: 'rgba(245,215,138,0.35)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: GOLD, fontSize: 30, fontWeight: '800', letterSpacing: 1, marginTop: 6, textShadowColor: 'rgba(124,77,255,0.8)', textShadowRadius: 12 },
  heroSub: { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 2 },
  seg: { flexDirection: 'row', marginHorizontal: 20, marginTop: 20, padding: 4, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  segItem: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: GOLD },
  segText: { color: 'rgba(255,255,255,0.75)', fontWeight: '600', fontSize: 14 },
  segTextOn: { color: '#2A1260', fontWeight: '800' },
  periods: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  period: { paddingHorizontal: 14, height: 30, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(245,215,138,0.4)', alignItems: 'center', justifyContent: 'center' },
  periodOn: { backgroundColor: 'rgba(245,215,138,0.95)', borderColor: GOLD },
  periodText: { color: GOLD, fontWeight: '600', fontSize: 12 },
  empty: { color: 'rgba(255,255,255,0.55)', textAlign: 'center', marginTop: 50 },
  podium: { marginHorizontal: 16, marginTop: 20 },
  podiumBg: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 24, paddingVertical: 20, paddingHorizontal: 8, borderWidth: 1, borderColor: 'rgba(245,215,138,0.35)' },
  slot: { flex: 1, alignItems: 'center', gap: 6 },
  ring: { borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  medal: { position: 'absolute', bottom: -9, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#1B0E3F' },
  medalText: { color: '#3B2A00', fontWeight: '800', fontSize: 11 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 8, maxWidth: '100%' },
  podName: { color: '#fff', fontWeight: '700', fontSize: 12, flexShrink: 1 },
  score: { color: GOLD, fontWeight: '700' },
  list: { marginHorizontal: 16, marginTop: 14, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 62, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  rank: { width: 26, textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontWeight: '700', fontSize: 15 },
  nameRow2: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowName: { color: '#fff', fontWeight: '600', fontSize: 15, flexShrink: 1 },
});
