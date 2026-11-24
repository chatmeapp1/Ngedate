import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { HostGrid } from '@/components/HostGrid';
import { Chip, ScreenHeader } from '@/components/ui';
import { countryName, flag } from '@/lib/countries';
import { colors } from '@/lib/theme';
import type { HostTab } from '@/lib/types';
import { useHosts } from '@/lib/useHosts';

const TABS: { key: HostTab; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'popular', label: 'Populer' },
  { key: 'new', label: 'Baru' },
  { key: 'online', label: 'Online' },
];

export default function CountryHosts() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [tab, setTab] = useState<HostTab>('all');
  const list = useHosts({ country: code, tab });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={`${flag(code)}  ${countryName(code)}`} />
      <HostGrid
        hosts={list.hosts}
        loading={list.loading}
        refreshing={list.refreshing}
        error={list.error}
        onRefresh={() => list.reload(true)}
        onEndReached={list.loadMore}
        emptyText={`Belum ada host dari ${countryName(code)}`}
        header={
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, padding: 16, paddingTop: 4 }}>
            {TABS.map((t) => (
              <Chip key={t.key} label={t.label} active={tab === t.key} onPress={() => setTab(t.key)} />
            ))}
          </ScrollView>
        }
      />
    </View>
  );
}
