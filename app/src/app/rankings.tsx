import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GiftIcon } from '@/components/GiftIcon';
import { Avatar, Coin } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { api } from '@/lib/api';
import { number } from '@/lib/format';
import { radius } from '@/lib/theme';

type Kind = 'gifts' | 'hosts' | 'senders';
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
interface Person {
  id: number;
  displayName: string;
  avatarUrl: string | null;
}
interface GiftEntry {
  rank: number;
  messageId: number;
  score: number;
  count: number;
  gift: { name: string; imageUrl: string | null; icon: string | null };
  sender: Person;
  host: Person;
}

const GOLD = '#F5D78A';
const RING = ['#F5D78A', '#C9D2E3', '#D9A066']; // emas, perak, perunggu
const MEDAL_BG = ['#FBE7A8', '#E2E8F3', '#F0C99A'];
const FRAME_RATIO = 364 / 1100; // tinggi / lebar gambar bingkai
const BG_COLOR = '#3A0493'; // warna dasar gambar latar

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
    <Pressable style={[s.slot, !first && { marginTop: 26 }]} onPress={() => onOpen(e)}>
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

/** Satu kotak "hadiah": [pengirim] [gift x jumlah] [host] di dalam bingkai. */
function GiftFrame({ e, width, onOpen }: { e: GiftEntry; width: number; onOpen: (hostId: number) => void }) {
  const h = width * FRAME_RATIO;
  const inner = h * 0.36; // tinggi bagian dalam bingkai (oval ungu)
  const avatar = Math.round(inner * 0.98);
  return (
    <Pressable onPress={() => onOpen(e.host.id)} style={{ width, marginBottom: 6 }}>
      <View style={{ width, height: h }}>
        <Image source={require('../../assets/rank-frame.png')} style={StyleSheet.absoluteFill} contentFit="fill" />
        <View style={[s.frameRow, { left: width * 0.15, right: width * 0.15, top: h * 0.42, height: inner }]}>
          <View style={[s.avRing, { width: avatar + 4, height: avatar + 4, borderRadius: (avatar + 4) / 2 }]}>
            <Avatar uri={e.sender.avatarUrl} name={e.sender.displayName} size={avatar} />
          </View>
          <View style={s.giftMid}>
            <GiftIcon icon={e.gift.icon} imageUrl={e.gift.imageUrl} size={Math.round(inner * 1.05)} />
            <Text style={s.giftCount}>×{number(e.count)}</Text>
          </View>
          <View style={[s.avRing, { width: avatar + 4, height: avatar + 4, borderRadius: (avatar + 4) / 2 }]}>
            <Avatar uri={e.host.avatarUrl} name={e.host.displayName} size={avatar} />
          </View>
        </View>
      </View>
      <View style={[s.caption, { paddingHorizontal: width * 0.08 }]}>
        <Text style={s.capName} numberOfLines={1}>
          {e.sender.displayName}
        </Text>
        <Text style={s.capMid} numberOfLines={1}>
          #{e.rank} · {e.gift.name} · {number(e.score)}
        </Text>
        <Text style={[s.capName, { textAlign: 'right' }]} numberOfLines={1}>
          {e.host.displayName}
        </Text>
      </View>
    </Pressable>
  );
}

// Papan peringkat: gift terbesar, host berpenghasilan terbanyak, pengirim gift terbanyak
export default function Rankings() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [kind, setKind] = useState<Kind>('gifts');
  const [period, setPeriod] = useState<Period>('week');
  // Data selalu disimpan bersama tab/periode asalnya, supaya data tab lama tidak pernah dirender dengan tampilan tab lain
  const [data, setData] = useState<{ kind: Kind; period: Period; items: (Entry | GiftEntry)[] } | null>(null);
  const items = data && data.kind === kind && data.period === period ? data.items : null;
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const k = kind;
    const p = period;
    try {
      const r = await api.get<{ items: (Entry | GiftEntry)[] }>(`/api/rankings?type=${k}&period=${p}`);
      setData({ kind: k, period: p, items: r.items });
    } catch {
      setData({ kind: k, period: p, items: [] });
    }
  }, [kind, period]);

  useEffect(() => {
    load();
  }, [load]);

  const openHost = (id: number) => router.push({ pathname: '/host/[id]', params: { id: String(id) } });
  const open = (e: Entry) => {
    if (kind === 'hosts') openHost(e.id);
  };
  const people = kind === 'gifts' ? [] : ((items ?? []) as Entry[]).filter((e) => typeof e.displayName === 'string');
  const top = people.slice(0, 3);
  const rest = people.slice(3);
  const frameW = width - 16;
  const artH = (width * 1280) / 720; // tinggi gambar latar pada lebar layar

  return (
    <View style={{ flex: 1, backgroundColor: BG_COLOR }}>
      {/* Latar: gambar selebar layar di bagian atas, sisanya warna ungu yang sama dengan dasar gambar */}
      <Image source={require('../../assets/rank-bg.jpg')} style={{ position: 'absolute', left: 0, top: 0, width, height: artH }} contentFit="fill" />
      <LinearGradient colors={['rgba(58,4,147,0)', BG_COLOR]} style={{ position: 'absolute', left: 0, width, top: artH - 70, height: 70 }} />
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <Text style={s.title}>Papan peringkat</Text>
        <View style={s.back} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: artH * 0.255, paddingBottom: insets.bottom + 30 }}
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
        {/* Pilihan */}
        <View style={s.seg}>
          {(
            [
              ['gifts', 'Hadiah'],
              ['hosts', 'Host'],
              ['senders', 'Pengirim'],
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
        <Text style={s.sub}>
          {kind === 'gifts' ? 'Gift bernilai terbesar dari pengirim untuk host' : kind === 'hosts' ? 'Host dengan penghasilan terbanyak' : 'Pengirim gift terbanyak'}
        </Text>

        {items === null ? (
          <ActivityIndicator color={GOLD} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <Text style={s.empty}>Belum ada data peringkat</Text>
        ) : kind === 'gifts' ? (
          <View style={{ alignItems: 'center', marginTop: 10 }}>
            {(items as GiftEntry[]).map((e) => (
              <GiftFrame key={e.messageId} e={e} width={frameW} onOpen={openHost} />
            ))}
          </View>
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
    </View>
  );
}

const s = StyleSheet.create({
  header: { position: 'absolute', zIndex: 5, left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6 },
  back: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: '700', textShadowColor: 'rgba(40,0,100,0.6)', textShadowRadius: 6 },
  seg: { flexDirection: 'row', marginHorizontal: 20, padding: 4, borderRadius: radius.pill, backgroundColor: 'rgba(20,6,60,0.55)' },
  segItem: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: GOLD },
  segText: { color: 'rgba(255,255,255,0.8)', fontWeight: '600', fontSize: 14 },
  segTextOn: { color: '#2A1260', fontWeight: '800' },
  periods: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  period: { paddingHorizontal: 14, height: 30, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(245,215,138,0.5)', backgroundColor: 'rgba(20,6,60,0.35)', alignItems: 'center', justifyContent: 'center' },
  periodOn: { backgroundColor: 'rgba(245,215,138,0.95)', borderColor: GOLD },
  periodText: { color: GOLD, fontWeight: '600', fontSize: 12 },
  sub: { color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontSize: 12, marginTop: 10 },
  empty: { color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginTop: 50 },
  // bingkai hadiah
  frameRow: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avRing: { borderWidth: 2, borderColor: GOLD, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#2A1260' },
  giftMid: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  giftCount: { color: GOLD, fontWeight: '800', fontSize: 16, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3 },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -2 },
  capName: { flex: 1, color: '#fff', fontWeight: '600', fontSize: 11 },
  capMid: { flex: 2, textAlign: 'center', color: GOLD, fontWeight: '700', fontSize: 11 },
  // podium & daftar
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 62, borderRadius: radius.md, backgroundColor: 'rgba(20,6,60,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  rank: { width: 26, textAlign: 'center', color: 'rgba(255,255,255,0.75)', fontWeight: '700', fontSize: 15 },
  nameRow2: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowName: { color: '#fff', fontWeight: '600', fontSize: 15, flexShrink: 1 },
});
