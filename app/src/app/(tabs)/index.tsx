import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HostGrid } from '@/components/HostGrid';
import { MemberGrid } from '@/components/MemberGrid';
import { RegionCard } from '@/components/RegionCard';
import { Chip, Coin } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { compact } from '@/lib/format';
import { colors, gradients, radius } from '@/lib/theme';
import type { HostTab, RegionCount, RegionKey, User } from '@/lib/types';
import { useHosts } from '@/lib/useHosts';

const TABS: { key: HostTab; label: string; icon: 'globe-outline' | 'flame-outline' | 'flash-outline' | 'radio-button-on' }[] = [
  { key: 'all', label: 'Semua', icon: 'globe-outline' },
  { key: 'popular', label: 'Populer', icon: 'flame-outline' },
  { key: 'new', label: 'Baru', icon: 'flash-outline' },
  { key: 'online', label: 'Online', icon: 'radio-button-on' },
];

// 6 wilayah selalu tampil, walaupun belum ada host
const EMPTY_REGIONS: RegionCount[] = (['asia', 'arab', 'india', 'latino', 'afrika', 'barat'] as RegionKey[]).map((key) => ({
  key,
  count: 0,
  coverUrl: null,
}));

export default function Home() {
  const insets = useSafeAreaInsets();
  const { user, refreshMe } = useAuth();
  const [tab, setTab] = useState<HostTab>('all');
  const [regions, setRegions] = useState<RegionCount[]>(EMPTY_REGIONS);
  // Akun host melihat pengguna pria; akun pria melihat host wanita
  const isHost = user?.role === 'host';
  const list = useHosts({ tab, enabled: !isHost });
  const members = useHosts<User>({ tab: tab === 'popular' ? 'all' : tab, path: '/api/members', enabled: isHost });

  const loadRegions = useCallback(() => {
    if (isHost) return;
    api.get<RegionCount[]>('/api/hosts/regions').then(setRegions).catch(() => {});
  }, [isHost]);

  useFocusEffect(
    useCallback(() => {
      loadRegions();
      refreshMe();
    }, [loadRegions, refreshMe])
  );

  const header = (
    <View>
      <LinearGradient colors={gradients.header} style={[s.hero, { paddingTop: insets.top + 12 }]}>
        <View style={s.titleRow}>
          <Text style={s.title}>Amora</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable style={s.coins} onPress={() => router.push('/wallet')}>
              <Coin size={18} />
              <Text style={s.coinsText}>{compact(user?.coins ?? 0)}</Text>
            </Pressable>
            <Pressable style={s.iconBtn} onPress={() => router.push('/search')} hitSlop={8}>
              <Ionicons name="search" size={22} color={colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={s.regionGrid}>
          {(isHost ? [] : regions).map((r) => (
            <View key={r.key} style={s.regionCell}>
              <RegionCard region={r} onPress={() => router.push({ pathname: '/region/[key]', params: { key: r.key } })} />
            </View>
          ))}
        </View>
      </LinearGradient>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
        {TABS.filter((t) => !isHost || t.key !== 'popular').map((t) => (
          <Chip key={t.key} label={t.label} icon={t.icon} active={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </ScrollView>
    </View>
  );

  if (isHost) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <MemberGrid
          members={members.hosts}
          loading={members.loading}
          refreshing={members.refreshing}
          error={members.error}
          onRefresh={() => members.reload(true)}
          onEndReached={members.loadMore}
          header={header}
          emptyText={tab === 'online' ? 'Belum ada pengguna yang online' : 'Belum ada pengguna'}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HostGrid
        hosts={list.hosts}
        loading={list.loading}
        refreshing={list.refreshing}
        error={list.error}
        onRefresh={() => {
          loadRegions();
          list.reload(true);
        }}
        onEndReached={list.loadMore}
        header={header}
        emptyText={tab === 'online' ? 'Belum ada host yang online' : 'Belum ada host'}
      />
    </View>
  );
}

const s = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  coins: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: radius.pill,
  },
  coinsText: { fontWeight: '800', color: colors.text },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  regionGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  regionCell: { width: '33.333%', padding: 5 },
  tabs: { gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
});
