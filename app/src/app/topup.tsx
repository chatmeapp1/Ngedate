import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Coin, Empty, Loading, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api, errorMessage } from '@/lib/api';
import { number } from '@/lib/format';
import { colors, gradients, radius } from '@/lib/theme';
import type { CoinPackage, TopupInfo } from '@/lib/types';

const priceText = (p: CoinPackage, currency: 'IDR' | 'USD') =>
  currency === 'IDR' ? `Rp ${number(p.priceIdr)}` : `$${(p.priceUsdCents / 100).toFixed(2)}`;

// Layar Top up: pilih paket, lalu pesan lewat WhatsApp admin (pesan sudah terisi paket & ID akun)
export default function Topup() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [info, setInfo] = useState<TopupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<TopupInfo>('/api/packages')
      .then((r) => {
        setInfo(r);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useFocusEffect(load);

  const order = async (p: CoinPackage) => {
    if (!info?.contact) {
      Alert.alert('Pemesanan belum tersedia', 'Kontak admin untuk top up belum diatur. Coba lagi nanti.');
      return;
    }
    const text =
      `Halo admin, saya ingin top up paket ${number(p.coins)} koin (${priceText(p, info.currency)}).\n` +
      `ID akun saya: ${user?.id}.`;
    try {
      await Linking.openURL(`https://wa.me/${info.contact}?text=${encodeURIComponent(text)}`);
    } catch {
      Alert.alert('WhatsApp tidak bisa dibuka', 'Pastikan WhatsApp terpasang di HP ini.');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Top up koin" />
      {!info ? (
        error ? <Empty icon="cloud-offline-outline" title={error} subtitle="Periksa koneksi lalu buka lagi" /> : <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 12 }}>
          <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.balance}>
            <Text style={s.balanceLabel}>Saldo koinmu</Text>
            <View style={s.balanceRow}>
              <Coin size={28} />
              <Text style={s.balanceValue}>{number(user?.coins ?? 0)}</Text>
            </View>
          </LinearGradient>

          {info.note ? (
            <View style={s.note}>
              <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
              <Text style={s.noteText}>{info.note}</Text>
            </View>
          ) : null}
          {!info.contact ? (
            <View style={[s.note, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="alert-circle-outline" size={20} color="#B45309" />
              <Text style={[s.noteText, { color: '#92400E' }]}>Pemesanan belum dibuka. Kontak admin belum diatur.</Text>
            </View>
          ) : null}

          {info.packages.length === 0 ? (
            <Empty icon="pricetags-outline" title="Belum ada paket koin" />
          ) : (
            info.packages.map((p) => (
              <Pressable key={p.id} onPress={() => order(p)} style={({ pressed }) => [s.pack, pressed && { opacity: 0.85 }]}>
                {p.badge ? (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{p.badge}</Text>
                  </View>
                ) : null}
                <View style={s.coinCircle}>
                  <Coin size={30} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.coins}>{number(p.coins)}</Text>
                  <Text style={s.coinsLabel}>koin</Text>
                </View>
                <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.price}>
                  <Text style={s.priceText}>{priceText(p, info.currency)}</Text>
                </LinearGradient>
              </Pressable>
            ))
          )}

          <Text style={s.footer}>
            Pembayaran dikonfirmasi manual oleh admin lewat WhatsApp. Koin masuk ke akun dengan ID {user?.id} setelah pembayaran diterima.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  balance: { borderRadius: radius.lg, padding: 18, gap: 6 },
  balanceLabel: { color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  balanceValue: { color: '#fff', fontSize: 32, fontWeight: '900' },
  note: { flexDirection: 'row', gap: 10, backgroundColor: '#F3E8FF', borderRadius: radius.md, padding: 12, alignItems: 'flex-start' },
  noteText: { flex: 1, color: colors.textSub, fontSize: 13, lineHeight: 19 },
  pack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  coinCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFF7E0', alignItems: 'center', justifyContent: 'center' },
  coins: { fontSize: 22, fontWeight: '900', color: colors.text, letterSpacing: -0.3 },
  coinsLabel: { fontSize: 12, color: colors.textDim, fontWeight: '700', marginTop: -2 },
  price: { paddingHorizontal: 16, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  priceText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  badge: { position: 'absolute', top: 0, right: 0, backgroundColor: colors.pink, paddingHorizontal: 12, paddingVertical: 3, borderBottomLeftRadius: 12 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  footer: { color: colors.textDim, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 4 },
});
