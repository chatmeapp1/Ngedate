import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { Coin, Empty, ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { number } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { LedgerEntry } from '@/lib/types';

type Kind = '' | 'spend' | 'topup' | 'reward' | 'refund';
const TABS: { key: Kind; label: string }[] = [
  { key: '', label: 'Semua' },
  { key: 'spend', label: 'Konsumsi' },
  { key: 'topup', label: 'Top up' },
  { key: 'reward', label: 'Imbalan' },
  { key: 'refund', label: 'Pengembalian' },
];

const REASONS: Record<string, string> = {
  chat_hold: 'Kirim pesan',
  chat_refund: 'Pengembalian: pesan tidak dibalas',
  gift_send: 'Kirim gift',
  media_unlock: 'Buka foto/video privat',
  admin_topup: 'Top up koin',
  topup: 'Top up koin',
  checkin: 'Hadiah untuk check in',
  task_reward: 'Imbalan tugas',
  salary_reward: 'Imbalan gaji pokok',
  admin_adjust: 'Penyesuaian admin',
  account_deleted: 'Akun dihapus',
};

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const lastMonths = (n: number) => {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
};

/** Detail penagihan: riwayat koin per bulan, dengan tab Semua / Konsumsi / Top up / Imbalan / Pengembalian. */
export default function Billing() {
  const [kind, setKind] = useState<Kind>('');
  const [month, setMonth] = useState(monthKey(new Date()));
  const [items, setItems] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);
  const [picker, setPicker] = useState(false);
  const busy = useRef(false);

  const fetchPage = useCallback(
    async (before?: number) => {
      const q = new URLSearchParams({ currency: 'coin', month });
      if (kind) q.set('kind', kind);
      if (before) q.set('before', String(before));
      return api.get<LedgerEntry[]>(`/api/wallet/ledger?${q.toString()}`);
    },
    [kind, month]
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setItems([]);
    setMore(true);
    fetchPage()
      .then((r) => {
        if (!live) return;
        setItems(r);
        setMore(r.length >= 50);
      })
      .catch(() => live && setMore(false))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [fetchPage]);

  const loadMore = async () => {
    if (busy.current || !more || !items.length) return;
    busy.current = true;
    try {
      const r = await fetchPage(items[items.length - 1].id);
      setItems((cur) => [...cur, ...r]);
      setMore(r.length >= 50);
    } catch {
      setMore(false);
    } finally {
      busy.current = false;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title="Detail penagihan"
        right={
          <Pressable onPress={() => setPicker(true)} style={s.month} hitSlop={8}>
            <Text style={s.monthText}>{month}</Text>
            <Ionicons name="caret-down" size={14} color={colors.text} />
          </Pressable>
        }
      />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
          {TABS.map((t) => (
            <Pressable key={t.key} onPress={() => setKind(t.key)} style={[s.tab, kind === t.key && s.tabOn]}>
              <Text style={[s.tabText, kind === t.key && s.tabTextOn]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<Empty icon="receipt-outline" title="Belum ada transaksi" subtitle="Tidak ada catatan untuk bulan dan kategori ini." />}
          renderItem={({ item }) => (
            <View style={s.card}>
              <Text style={s.title}>{REASONS[item.reason] ?? item.reason}</Text>
              <View style={s.bottom}>
                <Text style={s.date}>{stamp(item.createdAt)}</Text>
                <View style={s.amount}>
                  <Coin size={18} />
                  <Text style={[s.amountText, item.amount < 0 && { color: colors.text }]}>
                    {item.amount > 0 ? '+' : '-'}
                    {number(Math.abs(item.amount))}
                  </Text>
                </View>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={picker} transparent animationType="fade" onRequestClose={() => setPicker(false)}>
        <Pressable style={s.backdrop} onPress={() => setPicker(false)}>
          <View style={s.sheet}>
            {lastMonths(12).map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  setMonth(m);
                  setPicker(false);
                }}
                style={s.opt}
              >
                <Text style={[s.optText, m === month && { color: colors.primary, fontWeight: '800' }]}>{m}</Text>
                {m === month ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  month: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 90, marginLeft: -50, justifyContent: 'flex-end' },
  monthText: { fontSize: 14, fontWeight: '600', color: colors.text },
  tabs: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tab: { paddingHorizontal: 18, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#7C3AED' },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.textDim },
  tabTextOn: { color: '#fff', fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { fontSize: 13.5, color: colors.textSub },
  amount: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  amountText: { fontSize: 18, fontWeight: '800', color: '#7C3AED' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 40 },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, paddingVertical: 8 },
  opt: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  optText: { fontSize: 16, color: colors.text },
});
