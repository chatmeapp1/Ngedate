import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Coin, Empty } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { number } from '@/lib/format';
import { colors, gradients, radius } from '@/lib/theme';
import type { LedgerEntry, Wallet } from '@/lib/types';

const REASONS: Record<string, string> = {
  chat_hold: 'Kirim pesan',
  chat_refund: 'Pengembalian: pesan tidak dibalas',
  chat_income: 'Penghasilan chat',
  gift_send: 'Kirim gift',
  gift_income: 'Penghasilan gift',
  admin_topup: 'Top up',
  admin_adjust: 'Penyesuaian admin',
  withdraw_hold: 'Penarikan diamond',
  withdraw_refund: 'Penarikan dikembalikan',
  account_deleted: 'Akun dihapus',
};

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [w, l] = await Promise.all([
      api.get<Wallet>('/api/wallet').catch(() => null),
      api.get<LedgerEntry[]>('/api/wallet/ledger').catch(() => []),
    ]);
    if (w) setWallet(w);
    setLedger(l);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const isHost = user?.role === 'host';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={ledger}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            colors={[colors.primary]}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={
          <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, gap: 14 }}>
            <Text style={s.title}>Dompet</Text>
            <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.card}>
              <Text style={s.cardLabel}>Saldo koin</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Coin size={28} />
                <Text style={s.cardValue}>{number(wallet?.coins ?? user?.coins ?? 0)}</Text>
              </View>
              {wallet?.heldCoins ? (
                <Text style={s.cardSub}>{number(wallet.heldCoins)} koin sedang ditahan menunggu balasan host</Text>
              ) : null}
              <Pressable
                style={s.topup}
                onPress={() =>
                  Alert.alert('Top up', 'Pembelian koin lewat Google Play akan tersedia di update berikutnya. Untuk sementara hubungi admin.')
                }
              >
                <Ionicons name="add-circle" size={18} color={colors.primary} />
                <Text style={s.topupText}>Top up</Text>
              </Pressable>
            </LinearGradient>

            {isHost ? (
              <View style={s.diamond}>
                <Text style={{ fontSize: 26 }}>💎</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.diamondLabel}>Penghasilan (diamond)</Text>
                  <Text style={s.diamondValue}>{number(wallet?.diamonds ?? 0)}</Text>
                </View>
                <Pressable onPress={() => router.push('/withdraw')} style={s.withdrawBtn}>
                  <Text style={s.withdrawText}>Tarik</Text>
                </Pressable>
              </View>
            ) : null}
            <Text style={s.section}>Riwayat</Text>
          </View>
        }
        ListEmptyComponent={<Empty icon="receipt-outline" title="Belum ada transaksi" />}
        renderItem={({ item }) => (
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.reason}>{REASONS[item.reason] ?? item.reason}</Text>
              <Text style={s.date}>{new Date(item.createdAt).toLocaleString('id-ID')}</Text>
            </View>
            <Text style={[s.amount, { color: item.amount > 0 ? colors.online : colors.text }]}>
              {item.amount > 0 ? '+' : ''}
              {number(item.amount)} {item.currency === 'coin' ? 'koin' : '💎'}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  withdrawBtn: { paddingHorizontal: 16, height: 36, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  withdrawText: { color: '#fff', fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  card: { borderRadius: radius.lg, padding: 20, gap: 8 },
  cardLabel: { color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  cardValue: { color: '#fff', fontSize: 34, fontWeight: '900' },
  cardSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12 },
  topup: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    height: 38,
    borderRadius: radius.pill,
    marginTop: 6,
  },
  topupText: { color: colors.primary, fontWeight: '800' },
  diamond: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, padding: 16, borderRadius: radius.md },
  diamondLabel: { color: colors.textSub, fontWeight: '700' },
  diamondValue: { color: colors.text, fontSize: 22, fontWeight: '900' },
  section: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border },
  reason: { color: colors.text, fontWeight: '700' },
  date: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  amount: { fontWeight: '800' },
});
