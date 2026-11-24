import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Empty, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { colors } from '@/lib/theme';
import type { Conversation } from '@/lib/types';

function time(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toTimeString().slice(0, 5);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export default function Messages() {
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api.get<Conversation[]>('/api/conversations'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setList((l) => l ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 12 }}>
      <Text style={s.title}>Pesan</Text>
      {list === null ? (
        <Loading />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => String(c.id)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            error ? <Empty icon="cloud-offline-outline" title={error} /> : <Empty icon="chatbubbles-outline" title="Belum ada pesan" subtitle="Mulai ngobrol dengan host dari Beranda" />
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceAlt }]}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: String(item.id) } })}
            >
              <Avatar uri={item.peer?.avatarUrl} name={item.peer?.displayName} size={54} />
              <View style={{ flex: 1, gap: 3 }}>
                <View style={s.line}>
                  <Text style={s.name} numberOfLines={1}>
                    {item.peer?.displayName ?? 'Pengguna'}
                  </Text>
                  <Text style={s.time}>{time(item.lastMessageAt)}</Text>
                </View>
                <View style={s.line}>
                  <Text style={[s.preview, item.unread > 0 && { color: colors.text, fontWeight: '700' }]} numberOfLines={1}>
                    {item.lastMessagePreview ?? ''}
                  </Text>
                  {item.unread > 0 ? (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{item.unread > 99 ? '99+' : item.unread}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '900', color: colors.text, paddingHorizontal: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text },
  time: { fontSize: 12, color: colors.textDim },
  preview: { flex: 1, color: colors.textSub, fontSize: 14 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
