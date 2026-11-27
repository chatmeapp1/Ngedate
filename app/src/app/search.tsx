import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { TextInput } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HostGrid } from '@/components/HostGrid';
import { MemberGrid } from '@/components/MemberGrid';
import { useAuth } from '@/context/auth';
import { Empty } from '@/components/ui';
import { colors, radius } from '@/lib/theme';
import type { User } from '@/lib/types';
import { useHosts } from '@/lib/useHosts';

export default function Search() {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');

  // Tunggu 400 ms setelah berhenti mengetik baru mencari
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 400);
    return () => clearTimeout(t);
  }, [text]);

  const { user } = useAuth();
  const isHost = user?.role === 'host';
  const list = useHosts({ q, enabled: q.length > 0 && !isHost });
  const members = useHosts<User>({ q, path: '/api/members', enabled: q.length > 0 && isHost });
  const who = isHost ? 'pengguna' : 'host';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[s.bar, { paddingTop: insets.top + 8 }]}>
        <Pressable hitSlop={10} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={s.input}>
          <Ionicons name="search" size={18} color={colors.textDim} />
          <TextInput
            autoFocus
            value={text}
            onChangeText={setText}
            placeholder={`Cari nama atau ID ${who}`}
            placeholderTextColor={colors.textDim}
            style={s.text}
            returnKeyType="search"
            autoCorrect={false}
          />
          {text ? (
            <Pressable hitSlop={8} onPress={() => setText('')}>
              <Ionicons name="close-circle" size={18} color={colors.textDim} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {q && isHost ? (
        <MemberGrid
          members={members.hosts}
          loading={members.loading}
          refreshing={members.refreshing}
          error={members.error}
          onRefresh={() => members.reload(true)}
          onEndReached={members.loadMore}
          emptyText={`Tidak ada pengguna "${q}"`}
          header={<View style={{ height: 8 }} />}
        />
      ) : q ? (
        <HostGrid
          hosts={list.hosts}
          loading={list.loading}
          refreshing={list.refreshing}
          error={list.error}
          onRefresh={() => list.reload(true)}
          onEndReached={list.loadMore}
          emptyText={`Tidak ada host "${q}"`}
          header={<View style={{ height: 8 }} />}
        />
      ) : (
        <Empty icon="search-outline" title={`Cari ${who}`} subtitle={`Ketik nama tampilan atau ID ${who}`} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 8 },
  input: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  text: { flex: 1, color: colors.text, fontSize: 15 },
});
