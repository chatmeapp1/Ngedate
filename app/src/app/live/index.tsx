import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { Avatar, Empty, ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { onRealtime } from '@/lib/realtime';
import { colors } from '@/lib/theme';
import type { LiveItem } from '@/lib/types';

/** Daftar siaran live yang sedang berlangsung. */
export default function LiveList() {
  const [items, setItems] = useState<LiveItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.get<LiveItem[]>('/api/live'));
    } catch {
      setItems((cur) => cur ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(load, 10_000); // jumlah penonton & siaran baru
      return () => clearInterval(t);
    }, [load])
  );
  useEffect(() => onRealtime('live:ended', load), [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Live" />
      <FlatList
        data={items ?? []}
        numColumns={2}
        keyExtractor={(i) => String(i.id)}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            colors={[colors.primary]}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={items ? <Empty icon="videocam-outline" title="Belum ada yang live" subtitle="Siaran host yang sedang berlangsung akan muncul di sini." /> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: '/live/[id]', params: { id: String(item.id) } })} style={s.card}>
            {item.host.avatarUrl ? <Image source={{ uri: item.host.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#E9D5FF' }]}><Avatar name={item.host.displayName} size={72} /></View>}
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.72)']} style={s.shade} />
            <View style={s.live}>
              <View style={s.dot} />
              <Text style={s.liveText}>LIVE</Text>
            </View>
            <View style={s.viewers}>
              <Ionicons name="eye" size={12} color="#fff" />
              <Text style={s.viewersText}>{item.viewers}</Text>
            </View>
            <View style={s.info}>
              <Text style={s.title} numberOfLines={1}>
                {item.title || item.host.displayName}
              </Text>
              <Text style={s.host} numberOfLines={1}>
                {item.host.displayName}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  card: { flex: 1, aspectRatio: 0.78, borderRadius: 20, overflow: 'hidden', backgroundColor: '#EDE9FE' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 },
  live: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EF4444', paddingHorizontal: 8, height: 22, borderRadius: 11 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  viewers: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 8, height: 22, borderRadius: 11 },
  viewersText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  info: { position: 'absolute', left: 12, right: 12, bottom: 12 },
  title: { color: '#fff', fontWeight: '800', fontSize: 15 },
  host: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, marginTop: 2 },
});
