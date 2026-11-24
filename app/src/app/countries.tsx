import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Empty, Loading, ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { number } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import type { CountryCount } from '@/lib/types';

export default function Countries() {
  const [list, setList] = useState<CountryCount[] | null>(null);

  useEffect(() => {
    api.get<CountryCount[]>('/api/hosts/countries').then(setList).catch(() => setList([]));
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Semua negara" />
      {list === null ? (
        <Loading />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => c.code}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Empty title="Belum ada host" />}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [s.row, pressed && { opacity: 0.8 }]}
              onPress={() => router.push({ pathname: '/country/[code]', params: { code: item.code } })}
            >
              <Text style={{ fontSize: 28 }}>{flag(item.code)}</Text>
              <Text style={s.name}>{countryName(item.code)}</Text>
              <Text style={s.count}>{number(item.count)} host</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  count: { color: colors.textSub, fontWeight: '600' },
});
