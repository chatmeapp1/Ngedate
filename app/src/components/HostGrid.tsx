import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { HostCard } from '@/components/HostCard';
import { Empty } from '@/components/ui';
import { openChat } from '@/lib/openChat';
import { colors } from '@/lib/theme';
import type { Host } from '@/lib/types';

// Grid host 2 kolom yang dipakai di beranda, pencarian, dan halaman negara
export function HostGrid({
  hosts,
  loading,
  refreshing,
  error,
  onRefresh,
  onEndReached,
  header,
  emptyText = 'Belum ada host',
  bottomInset = 16,
}: {
  hosts: Host[];
  loading: boolean;
  refreshing: boolean;
  error?: string | null;
  onRefresh: () => void;
  onEndReached: () => void;
  header?: ReactElement;
  emptyText?: string;
  bottomInset?: number;
}) {
  return (
    <FlatList
      data={hosts}
      keyExtractor={(h) => String(h.id)}
      numColumns={2}
      columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
      contentContainerStyle={{ gap: 12, paddingBottom: bottomInset }}
      ListHeaderComponent={header}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      renderItem={({ item }) => (
        <HostCard
          host={item}
          onPress={() => router.push({ pathname: '/host/[id]', params: { id: String(item.id) } })}
          onMessage={() => openChat(item.id)}
        />
      )}
      ListEmptyComponent={
        loading ? null : error ? <Empty icon="cloud-offline-outline" title={error} subtitle="Tarik ke bawah untuk mencoba lagi" /> : <Empty icon="people-outline" title={emptyText} />
      }
      ListFooterComponent={loading ? <View style={{ paddingVertical: 20 }}><ActivityIndicator color={colors.primary} /></View> : null}
    />
  );
}
