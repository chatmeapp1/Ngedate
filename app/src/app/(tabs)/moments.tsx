import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Empty, Loading } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { compact } from '@/lib/format';
import { colors, gradients } from '@/lib/theme';
import type { Moment } from '@/lib/types';

type Tab = 'popular' | 'new' | 'mine';
interface Page {
  items: Moment[];
  hasMore: boolean;
}

const TEXT_BG: readonly (readonly [string, string])[] = [
  ['#C4B5FD', '#F9A8D4'],
  ['#FDBA74', '#F9A8D4'],
  ['#7DD3FC', '#C4B5FD'],
  ['#86EFAC', '#7DD3FC'],
];

export default function Moments() {
  const { user } = useAuth();
  const isHost = user?.role === 'host';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardW = (width - 16 * 2 - 10) / 2;
  const [tab, setTab] = useState<Tab>('popular');
  // Data disimpan bersama tab-nya supaya tidak tampil data tab lain saat berpindah
  const [data, setData] = useState<{ tab: Tab; items: Moment[]; more: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadingMore = useRef(false);

  const load = useCallback(async (t: Tab) => {
    try {
      const r = await api.get<Page>(`/api/moments?tab=${t}`);
      setData({ tab: t, items: r.items, more: r.hasMore });
    } catch {
      setData((d) => d ?? { tab: t, items: [], more: false });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(tab);
    }, [tab, load])
  );

  const loadMore = async () => {
    if (!data || data.tab !== tab || !data.more || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const r = await api.get<Page>(`/api/moments?tab=${tab}&offset=${data.items.length}`);
      setData((d) => (d && d.tab === tab ? { ...d, items: [...d.items, ...r.items.filter((x) => !d.items.some((y) => y.id === x.id))], more: r.hasMore } : d));
    } catch {
      /* coba lagi saat gulir berikutnya */
    } finally {
      loadingMore.current = false;
    }
  };

  const tabs: [Tab, string][] = [
    ['popular', 'Populer'],
    ['new', 'Baru'],
    ...(isHost ? ([['mine', 'Punya saya']] as [Tab, string][]) : []),
  ];
  const items = data && data.tab === tab ? data.items : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={gradients.header} style={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={s.title}>Momen</Text>
        <View style={s.tabs}>
          {tabs.map(([k, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]}>
              <Text style={[s.tabText, tab === k && s.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </LinearGradient>

      {items === null ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(m) => String(m.id)}
          numColumns={2}
          columnWrapperStyle={{ gap: 10, paddingHorizontal: 16 }}
          contentContainerStyle={{ gap: 10, paddingTop: 8, paddingBottom: 100 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load(tab);
                setRefreshing(false);
              }}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <Empty
              icon="images-outline"
              title={tab === 'mine' ? 'Belum ada momen' : 'Belum ada momen'}
              subtitle={isHost ? 'Ketuk tombol kamera untuk membagikan momen pertamamu' : 'Momen dari host akan muncul di sini'}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/moment/[id]', params: { id: String(item.id) } })}
              style={[s.card, { width: cardW, height: cardW * 1.45 }]}
            >
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
              ) : (
                <LinearGradient colors={TEXT_BG[item.id % TEXT_BG.length]} style={[StyleSheet.absoluteFill, s.textCard]}>
                  <Text style={s.textBody} numberOfLines={6}>
                    {item.body}
                  </Text>
                </LinearGradient>
              )}
              {item.status !== 'approved' ? (
                <View style={[s.status, item.status === 'rejected' && { backgroundColor: 'rgba(239,68,68,0.92)' }]}>
                  <Text style={s.statusText}>{item.status === 'pending' ? 'Menunggu persetujuan' : 'Ditolak'}</Text>
                </View>
              ) : null}
              <LinearGradient colors={['transparent', 'rgba(236,72,153,0.85)']} style={s.cardFoot}>
                <Ionicons name="stats-chart" size={14} color="#fff" />
                <Text style={s.cardViews}>{compact(item.views)}</Text>
                <View style={{ flex: 1 }} />
                <Ionicons name="heart" size={12} color="#fff" />
                <Text style={s.cardViews}>{compact(item.likes)}</Text>
              </LinearGradient>
            </Pressable>
          )}
        />
      )}

      {isHost ? (
        <Pressable onPress={() => router.push('/moment/new')} style={s.fab}>
          <LinearGradient colors={gradients.brand} style={s.fabIn}>
            <Ionicons name="camera" size={24} color="#fff" />
          </LinearGradient>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: 6, marginTop: 12 },
  tab: { paddingHorizontal: 14, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#E9DDFF' },
  tabText: { color: colors.textSub, fontSize: 14, fontWeight: '500' },
  tabTextOn: { color: colors.primary, fontWeight: '700' },
  card: { borderRadius: 18, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  textCard: { padding: 14, justifyContent: 'center' },
  textBody: { color: '#fff', fontSize: 15, fontWeight: '600', lineHeight: 21 },
  cardFoot: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  status: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(17,10,30,0.7)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  cardViews: { color: '#fff', fontSize: 13, fontWeight: '600' },
  fab: { position: 'absolute', right: 18, bottom: 22, borderRadius: 30, elevation: 6, shadowColor: colors.pink, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  fabIn: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
});
