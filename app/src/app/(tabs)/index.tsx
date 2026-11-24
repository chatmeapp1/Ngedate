import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HostGrid } from '@/components/HostGrid';
import { Chip, Coin } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { compact, number } from '@/lib/format';
import { colors, countryCardGradients, gradients, radius } from '@/lib/theme';
import type { CountryCount, HostTab } from '@/lib/types';
import { useHosts } from '@/lib/useHosts';

const TABS: { key: HostTab; label: string; icon: 'globe-outline' | 'flame-outline' | 'flash-outline' | 'radio-button-on' }[] = [
  { key: 'all', label: 'Semua', icon: 'globe-outline' },
  { key: 'popular', label: 'Populer', icon: 'flame-outline' },
  { key: 'new', label: 'Baru', icon: 'flash-outline' },
  { key: 'online', label: 'Online', icon: 'radio-button-on' },
];

export default function Home() {
  const insets = useSafeAreaInsets();
  const { user, refreshMe } = useAuth();
  const [tab, setTab] = useState<HostTab>('all');
  const [countries, setCountries] = useState<CountryCount[]>([]);
  const list = useHosts({ tab });

  const loadCountries = useCallback(() => {
    api.get<CountryCount[]>('/api/hosts/countries').then(setCountries).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCountries();
      refreshMe();
    }, [loadCountries, refreshMe])
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

        {countries.length ? (
          <View style={s.countryGrid}>
            {countries.slice(0, 6).map((c, i) => {
              const g = countryCardGradients[i % countryCardGradients.length];
              return (
                <Pressable
                  key={c.code}
                  style={s.countryCell}
                  onPress={() => router.push({ pathname: '/country/[code]', params: { code: c.code } })}
                >
                  <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.countryCard}>
                    <Text style={s.countryFlag}>{flag(c.code)}</Text>
                    <Text style={s.countryName} numberOfLines={1}>
                      {countryName(c.code)}
                    </Text>
                    <View style={s.countryCount}>
                      <Ionicons name="people" size={12} color="rgba(255,255,255,0.9)" />
                      <Text style={s.countryCountText}>{number(c.count)}</Text>
                    </View>
                  </LinearGradient>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {countries.length > 6 ? (
          <Pressable onPress={() => router.push('/countries')} style={s.more}>
            <Text style={s.moreText}>Semua negara ({countries.length})</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </Pressable>
        ) : null}
      </LinearGradient>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
        {TABS.map((t) => (
          <Chip key={t.key} label={t.label} icon={t.icon} active={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HostGrid
        hosts={list.hosts}
        loading={list.loading}
        refreshing={list.refreshing}
        error={list.error}
        onRefresh={() => {
          loadCountries();
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
  hero: { paddingHorizontal: 16, paddingBottom: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 30, fontWeight: '900', color: colors.text, letterSpacing: -0.5 },
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
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  countryGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  countryCell: { width: '33.333%', padding: 5 },
  countryCard: { height: 92, borderRadius: radius.md, padding: 12, justifyContent: 'space-between', overflow: 'hidden' },
  countryFlag: { position: 'absolute', right: -6, bottom: -10, fontSize: 54, opacity: 0.9 },
  countryName: { color: '#fff', fontWeight: '800', fontSize: 16 },
  countryCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countryCountText: { color: 'rgba(255,255,255,0.95)', fontWeight: '700', fontSize: 13 },
  more: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 2, marginTop: 6 },
  moreText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  tabs: { gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
});
