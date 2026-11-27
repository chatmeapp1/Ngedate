import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Empty, Loading, ScreenHeader } from '@/components/ui';
import { useRealtime } from '@/context/realtime';
import { api } from '@/lib/api';
import { onRealtime } from '@/lib/realtime';
import { colors } from '@/lib/theme';
import type { AppNotification } from '@/lib/types';

const META: Record<string, { icon: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  topup: { icon: 'wallet', color: '#F59E0B' },
  photo: { icon: 'image', color: '#8B5CF6' },
  avatar: { icon: 'person-circle', color: '#8B5CF6' },
  moment: { icon: 'images', color: '#EC4899' },
  agency: { icon: 'business', color: '#0EA5E9' },
  withdraw: { icon: 'cash', color: '#22C55E' },
};

function when(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Notifikasi sistem: top up, foto disetujui, bergabung agency, penarikan terkirim. */
export default function Notifications() {
  const { refreshNotifUnread } = useRealtime();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.get<AppNotification[]>('/api/notifications'));
      api.post('/api/notifications/read').then(refreshNotifUnread).catch(() => {});
    } catch {
      setItems((i) => i ?? []);
    }
  }, [refreshNotifUnread]);

  useFocusEffect(
    useCallback(() => {
      load();
      return onRealtime('notification:new', () => load());
    }, [load])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Notifikasi" />
      {items === null ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => String(n.id)}
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
          ListEmptyComponent={<Empty icon="notifications-outline" title="Belum ada notifikasi" subtitle="Top up, persetujuan foto, dan penarikan akan muncul di sini" />}
          contentContainerStyle={{ paddingVertical: 6 }}
          renderItem={({ item }) => {
            const m = META[item.type] ?? { icon: 'notifications' as const, color: colors.primary };
            return (
              <View style={s.row}>
                <View style={[s.icon, { backgroundColor: m.color + '22' }]}>
                  <Ionicons name={m.icon} size={22} color={m.color} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={s.line}>
                    <Text style={s.title} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={s.time}>{when(item.createdAt)}</Text>
                  </View>
                  <Text style={s.body}>{item.body}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  time: { fontSize: 11, color: colors.textDim },
  body: { fontSize: 13.5, color: colors.textSub, lineHeight: 19 },
});
