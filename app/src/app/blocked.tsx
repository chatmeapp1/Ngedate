import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Avatar, Empty, Loading, ScreenHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { emitBlockChange } from '@/lib/blockEvents';
import { colors, radius } from '@/lib/theme';

interface Blocked {
  id: number;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  role: string;
}

// Daftar pengguna yang kamu blokir, dengan tombol buka blokir
export default function BlockedUsers() {
  const [list, setList] = useState<Blocked[] | null>(null);

  const load = useCallback(() => {
    api.get<Blocked[]>('/api/blocks').then(setList).catch(() => setList([]));
  }, []);
  useFocusEffect(load);

  const unblock = (u: Blocked) => {
    Alert.alert(`Buka blokir ${u.displayName}?`, 'Kalian bisa saling melihat dan saling mengirim pesan lagi.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Buka blokir',
        onPress: async () => {
          try {
            await api.del(`/api/blocks/${u.id}`);
            setList((cur) => (cur ?? []).filter((x) => x.id !== u.id));
            emitBlockChange();
          } catch (e) {
            Alert.alert('Gagal', errorMessage(e));
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Pengguna diblokir" />
      {list === null ? (
        <Loading />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(u) => String(u.id)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={<Empty icon="shield-checkmark-outline" title="Belum ada yang diblokir" subtitle="Akun yang kamu blokir akan muncul di sini" />}
          renderItem={({ item }) => (
            <View style={s.row}>
              <Avatar uri={item.avatarUrl} name={item.displayName} size={46} />
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={s.sub}>@{item.username}</Text>
              </View>
              <Pressable onPress={() => unblock(item)} style={s.btn}>
                <Text style={s.btnText}>Buka blokir</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, padding: 12 },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  sub: { fontSize: 13, color: colors.textDim },
  btn: { paddingHorizontal: 14, height: 36, borderRadius: radius.pill, backgroundColor: '#F3E8FF', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: colors.primaryDark, fontWeight: '800', fontSize: 13 },
});
