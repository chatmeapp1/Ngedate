import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { Empty, Loading, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { number } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { SalaryStatus } from '@/lib/types';

const pad = (n: number) => String(n).padStart(2, '0');
function remain(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d} hari ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(sec % 60)}`;
}

function Bar({ label, value, max, done, suffix = '' }: { label: string; value: number; max: number; done: boolean; suffix?: string }) {
  const pct = max > 0 ? Math.min(1, value / max) : 1;
  return (
    <View style={{ gap: 6 }}>
      <View style={s.barHead}>
        <Text style={s.barLabel}>{label}</Text>
        <Text style={[s.barValue, done && { color: '#16A34A' }]}>
          {number(value)}/{number(max)}
          {suffix}
        </Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: done ? '#22C55E' : colors.primary }]} />
      </View>
    </View>
  );
}

/** Gaji pokok host: syarat online, hari valid, dan target pendapatan. Dibayar otomatis bila semuanya terpenuhi. */
export default function Salary() {
  const { refreshMe } = useAuth();
  const [st, setSt] = useState<SalaryStatus | null>(null);
  const [left, setLeft] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<SalaryStatus>('/api/salary');
      setSt(r);
      setLeft(r.weekEndsIn ?? 0);
      if (r.paid) refreshMe(); // saldo diamond bertambah
    } catch {
      setSt((x) => x ?? { enrolled: false });
    }
  }, [refreshMe]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Selama layar terbuka, segarkan tiap menit supaya menit online & pendapatan ikut bergerak
      const t = setInterval(load, 60_000);
      return () => clearInterval(t);
    }, [load])
  );
  useEffect(() => {
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#F4F4F4' }}>
      <ScreenHeader title="Gaji pokok" />
      {st === null ? (
        <Loading />
      ) : !st.enrolled ? (
        <Empty icon="wallet-outline" title="Belum ikut program gaji pokok" subtitle="Hubungi admin atau agency untuk bergabung" />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
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
        >
          <View style={s.card}>
            <Text style={s.title}>
              Gaji pokok: online di app selama {number(st.minutesPerDay ?? 0)} menit setiap hari selama {st.daysRequired} hari dalam seminggu, dan capai target
              pendapatan dari pesan maupun gift untuk mendapatkan {number(st.reward ?? 0)} diamond.
            </Text>
            <Text style={s.note}>
              📌 Hari dihitung valid jika online di app minimal {number(st.minutesPerDay ?? 0)} menit. Gaji dibayar otomatis begitu semua syarat terpenuhi.
            </Text>

            <View style={s.bars}>
              <Bar label="Online hari ini" value={Math.min(st.todayMinutes ?? 0, st.minutesPerDay ?? 0)} max={st.minutesPerDay ?? 0} done={(st.todayMinutes ?? 0) >= (st.minutesPerDay ?? 1)} suffix=" menit" />
              <Bar label="Hari valid minggu ini" value={st.validDays ?? 0} max={st.daysRequired ?? 0} done={(st.validDays ?? 0) >= (st.daysRequired ?? 1)} suffix=" hari" />
              <Bar label="Target pendapatan (chat + gift)" value={Math.min(st.income ?? 0, st.incomeTarget ?? 0)} max={st.incomeTarget ?? 0} done={(st.income ?? 0) >= (st.incomeTarget ?? 1)} />
            </View>

            <View style={s.rewardRow}>
              <Ionicons name="diamond" size={20} color="#38BDF8" />
              <Text style={s.rewardText}>+{number(st.reward ?? 0)}</Text>
              <View style={{ flex: 1 }} />
              <View style={[s.chip, st.paid ? { backgroundColor: '#DCFCE7' } : st.met ? { backgroundColor: '#E0F2FE' } : null]}>
                <Text style={[s.chipText, st.paid ? { color: '#15803D' } : null]}>{st.paid ? 'Sudah dibayar' : st.met ? 'Segera dibayar' : 'Berjalan'}</Text>
              </View>
            </View>
          </View>

          <View style={s.timer}>
            <Ionicons name="time" size={16} color="#F43F5E" />
            <Text style={s.timerText}>Periode ini berakhir dalam {remain(left)} (Senin 00:00 WIB mulai ulang)</Text>
          </View>
          <Text style={s.hint}>Waktu online dihitung saat app terbuka di layar. Pesan gratis dan hadiah tugas tidak dihitung sebagai pendapatan.</Text>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 14 },
  title: { fontSize: 16, fontWeight: '600', color: colors.text, lineHeight: 24 },
  note: { fontSize: 13.5, color: colors.textSub, lineHeight: 20 },
  bars: { gap: 14, marginTop: 4 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  barLabel: { flex: 1, fontSize: 13.5, color: colors.text, fontWeight: '500' },
  barValue: { fontSize: 13.5, color: colors.textSub, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#EEE8F7', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  rewardText: { fontSize: 20, fontWeight: '700', color: '#C026D3' },
  chip: { paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: '#F1ECFB', alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFE4E8', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  timerText: { flex: 1, color: '#F43F5E', fontSize: 12.5, fontWeight: '600' },
  hint: { fontSize: 12, color: colors.textDim, lineHeight: 18 },
});
