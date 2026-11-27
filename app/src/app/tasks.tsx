import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Loading, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api, errorMessage } from '@/lib/api';
import { number } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { HostTask } from '@/lib/types';

const ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  moment: 'images',
  photos: 'camera',
  checkin: 'calendar',
  like: 'heart',
};

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (sec: number) => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;

/** Tugas host: pemula (sekali) dan harian (reset 00:00 WIB). Hadiah berupa diamond. */
export default function Tasks() {
  const { refreshMe } = useAuth();
  const [data, setData] = useState<{ tasks: HostTask[]; resetIn: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ tasks: HostTask[]; resetIn: number }>('/api/tasks');
      setData(r);
      setLeft(r.resetIn);
    } catch (e) {
      setData((d) => d ?? { tasks: [], resetIn: 0 });
      Alert.alert('Gagal memuat', errorMessage(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Hitung mundur reset harian; saat habis, muat ulang
  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => setLeft((l) => (l <= 1 ? (load(), 0) : l - 1)), 1000);
    return () => clearInterval(t);
  }, [data, load]);

  const claim = async (t: HostTask) => {
    setBusy(t.key);
    try {
      const r = await api.post<{ reward: number; tasks: HostTask[]; resetIn: number }>(`/api/tasks/${t.key}/claim`);
      setData({ tasks: r.tasks, resetIn: r.resetIn });
      refreshMe();
      Alert.alert('Hadiah diterima', `+${number(r.reward)} diamond masuk ke saldo kamu.`);
    } catch (e) {
      Alert.alert('Gagal', errorMessage(e));
      load();
    } finally {
      setBusy(null);
    }
  };

  const start = (t: HostTask) => {
    if (t.go === 'moment') router.push('/moment/new');
    else if (t.go === 'photos') router.push('/edit-profile');
    else router.push('/'); // sukai: cari pengguna di Beranda
  };

  const card = (t: HostTask) => {
    const claimable = t.state === 'claimable';
    const done = t.state === 'done';
    return (
      <View key={t.key} style={s.card}>
        <View style={s.cardTop}>
          <View style={s.icon}>
            <Ionicons name={ICON[t.key] ?? 'star'} size={26} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={s.title}>{t.title}</Text>
            <View style={s.reward}>
              <Ionicons name="diamond" size={16} color="#38BDF8" />
              <Text style={s.rewardText}>+{number(t.reward)}</Text>
            </View>
          </View>
        </View>
        <Pressable
          disabled={done || busy === t.key}
          onPress={() => (claimable ? claim(t) : start(t))}
          style={[s.btn, claimable && { backgroundColor: '#22C55E' }, done && { backgroundColor: '#D1D5DB' }]}
        >
          {busy === t.key ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>{done ? 'Selesai' : claimable ? 'Klaim' : 'Mulai'}</Text>}
        </Pressable>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F4F4' }}>
      <ScreenHeader title="Tugas harian" />
      {data === null ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
          <Text style={s.section}>Tugas pemula</Text>
          {data.tasks.filter((t) => t.group === 'beginner').map(card)}

          <View style={s.dailyHead}>
            <Text style={s.section}>Tugas harian</Text>
            <View style={s.timer}>
              <Ionicons name="time" size={16} color="#F43F5E" />
              <Text style={s.timerText}>Tugas akan direset dalam {clock(left)}.</Text>
            </View>
          </View>
          {data.tasks.filter((t) => t.group === 'daily').map(card)}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 6 },
  dailyHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFE4E8', paddingHorizontal: 10, height: 28, borderRadius: 8 },
  timerText: { color: '#F43F5E', fontSize: 12, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden' },
  cardTop: { flexDirection: 'row', gap: 14, padding: 16, paddingBottom: 14 },
  icon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#F1ECFB', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15.5, fontWeight: '600', color: colors.text, lineHeight: 22 },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rewardText: { color: '#7C4DFF', fontSize: 16, fontWeight: '700' },
  btn: { height: 40, backgroundColor: '#FF7A1A', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
