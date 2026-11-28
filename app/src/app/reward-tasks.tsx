import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openCheckin } from '@/components/CheckinModal';
import { Coin, Loading } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api, errorMessage } from '@/lib/api';
import { number } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { HostTask } from '@/lib/types';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const ICON: Record<string, { name: IconName; bg: [string, string] }> = {
  avatar: { name: 'person-add', bg: ['#A855F7', '#7C3AED'] },
  match: { name: 'heart-circle', bg: ['#FB7185', '#F43F5E'] },
  match_day: { name: 'heart-circle', bg: ['#FB7185', '#F43F5E'] },
  follow: { name: 'heart', bg: ['#F472B6', '#EC4899'] },
  topup: { name: 'card', bg: ['#FB7185', '#E11D48'] },
  vip: { name: 'diamond', bg: ['#4C1D95', '#2E1065'] },
  beginner_all: { name: 'ribbon', bg: ['#818CF8', '#6366F1'] },
  daily_all: { name: 'ribbon', bg: ['#818CF8', '#6366F1'] },
  checkin: { name: 'calendar', bg: ['#34D399', '#10B981'] },
  chat: { name: 'chatbubble-ellipses', bg: ['#FDBA74', '#F97316'] },
  gift: { name: 'gift', bg: ['#F0ABFC', '#D946EF'] },
  momlike: { name: 'images', bg: ['#67E8F9', '#06B6D4'] },
};

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (sec: number) => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;

/** Imbalan tugas pengguna: tugas pemula (sekali) dan harian (reset 00:00 WIB). Hadiah berupa koin. */
export default function RewardTasks() {
  const { refreshMe } = useAuth();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<{ tasks: HostTask[]; resetIn: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ tasks: HostTask[]; resetIn: number }>('/api/user-tasks');
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

  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => setLeft((l) => (l <= 1 ? (load(), 0) : l - 1)), 1000);
    return () => clearInterval(t);
  }, [data, load]);

  const claim = async (t: HostTask) => {
    setBusy(t.key);
    try {
      const r = await api.post<{ reward: number; tasks: HostTask[]; resetIn: number }>(`/api/user-tasks/${t.key}/claim`);
      setData({ tasks: r.tasks, resetIn: r.resetIn });
      refreshMe();
      Alert.alert('Hadiah diterima', `+${number(r.reward)} koin masuk ke saldo kamu.`);
    } catch (e) {
      Alert.alert('Gagal', errorMessage(e));
      load();
    } finally {
      setBusy(null);
    }
  };

  const start = (t: HostTask) => {
    switch (t.go) {
      case 'profile':
        return router.push('/edit-profile');
      case 'match':
        return router.push('/(tabs)/match');
      case 'moments':
        return router.push('/(tabs)/moments');
      case 'topup':
        return router.push('/topup');
      case 'vip':
        return router.push('/vip');
      case 'checkin':
        return openCheckin();
      case 'none':
        return;
      default:
        return router.push('/(tabs)');
    }
  };

  const row = (t: HostTask, last: boolean) => {
    const claimable = t.state === 'claimable';
    const done = t.state === 'done';
    const ic = ICON[t.key] ?? { name: 'star' as IconName, bg: ['#A78BFA', '#7C3AED'] as [string, string] };
    return (
      <View key={t.key} style={[s.row, !last && s.rowLine]}>
        <LinearGradient colors={ic.bg} style={s.icon}>
          <Ionicons name={ic.name} size={26} color="#fff" />
        </LinearGradient>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={s.title}>{t.title}</Text>
          <View style={s.reward}>
            <Coin size={15} />
            <Text style={s.rewardText}>+{number(t.reward)}</Text>
          </View>
        </View>
        <Pressable
          disabled={done || busy === t.key || (t.go === 'none' && !claimable)}
          onPress={() => (claimable ? claim(t) : start(t))}
          style={[s.btn, claimable && { backgroundColor: '#22C55E' }, done && s.btnDone, t.go === 'none' && !claimable && !done && { opacity: 0.45 }]}
        >
          {busy === t.key ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[s.btnText, done && { color: '#9CA3AF' }]}>{done ? 'Selesai' : claimable ? 'Klaim' : 'Mulai'}</Text>}
        </Pressable>
      </View>
    );
  };

  const group = (g: 'beginner' | 'daily') => {
    const list = data!.tasks.filter((t) => t.group === g);
    return list.map((t, i) => row(t, i === list.length - 1));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={['#C4A4F5', '#F3E8FF', colors.bg]} style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={s.back}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={s.headerTitle}>Imbalan tugas</Text>
        <View style={s.back} />
      </LinearGradient>
      {data === null ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 16, paddingBottom: insets.bottom + 32 }}>
          <View style={s.panel}>
            <Text style={s.section}>Tugas pemula</Text>
            {group('beginner')}
          </View>
          <View style={s.panel}>
            <View style={s.dailyHead}>
              <Text style={s.section}>Tugas harian</Text>
              <View style={s.timer}>
                <Ionicons name="time" size={14} color="#F43F5E" />
                <Text style={s.timerText}>Reset dalam {clock(left)}</Text>
              </View>
            </View>
            {group('daily')}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 14 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '800', color: colors.text },
  panel: { backgroundColor: '#F5EFFE', borderRadius: 26, padding: 18 },
  section: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 6 },
  dailyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFE4E8', paddingHorizontal: 10, height: 26, borderRadius: 8 },
  timerText: { color: '#F43F5E', fontSize: 11.5, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: 'rgba(124,58,237,0.12)' },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 21 },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rewardText: { color: '#7C4DFF', fontSize: 15, fontWeight: '700' },
  btn: { minWidth: 84, height: 40, borderRadius: 14, backgroundColor: '#8B5CF6', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  btnDone: { backgroundColor: '#E5E7EB' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
