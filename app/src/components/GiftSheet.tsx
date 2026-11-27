import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GiftIcon } from '@/components/GiftIcon';
import { Coin, GradientButton } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { ApiError, api, errorMessage } from '@/lib/api';
import { compact, number } from '@/lib/format';
import { LUXURY_PRICE, playGift, playWaUnlocked } from '@/lib/giftFx';
import { colors, radius } from '@/lib/theme';
import type { Gift, SendGiftResult, WhatsappStatus } from '@/lib/types';

const COUNTS = [1, 10, 99, 520];
let cache: Gift[] | null = null;

const isLuxury = (g: Gift) => g.category === 'luxury' || g.price >= LUXURY_PRICE;

/**
 * Panel kirim gift (bottom sheet).
 * getConversationId: id percakapan (dibuat dulu jika dibuka dari profil host).
 */
export function GiftSheet({
  visible,
  onClose,
  getConversationId,
  hostName,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  getConversationId: () => Promise<number>;
  hostName?: string;
  onSent?: (r: SendGiftResult, conversationId: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [gifts, setGifts] = useState<Gift[] | null>(cache);
  const [tab, setTab] = useState<'normal' | 'luxury'>('normal');
  const [selected, setSelected] = useState<Gift | null>(null);
  const [count, setCount] = useState(1);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    api
      .get<Gift[]>('/api/gifts')
      .then((g) => {
        cache = g;
        setGifts(g);
      })
      .catch(() => {});
  }, [visible]);

  const list = (gifts ?? []).filter((g) => (tab === 'luxury') === isLuxury(g));
  const coins = user?.coins ?? 0;
  const total = selected ? selected.price * count : 0;
  const enough = coins >= total;

  const send = async () => {
    if (!selected || sending) return;
    if (!enough) {
      Alert.alert('Koin tidak cukup', `Butuh ${number(total)} koin, saldo kamu ${number(coins)}.`, [
        { text: 'Nanti', style: 'cancel' },
        { text: 'Top up', onPress: () => (onClose(), router.push('/topup')) },
      ]);
      return;
    }
    setSending(true);
    try {
      const convId = await getConversationId();
      const r = await api.post<SendGiftResult>(`/api/conversations/${convId}/gifts`, { giftId: selected.id, count });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onClose();
      playGift({
        messageId: r.message.id,
        giftId: selected.id,
        name: selected.name,
        icon: selected.icon,
        imageUrl: selected.imageUrl,
        videoUrl: selected.animationUrl,
        soundUrl: selected.soundUrl,
        blend: selected.animationBlend,
        count,
        price: selected.price,
        category: selected.category,
      });
      if (r.waUnlocked) {
        const wa = await api.get<WhatsappStatus>(`/api/conversations/${convId}/whatsapp`).catch(() => null);
        playWaUnlocked(convId, hostName, wa?.link);
      }
      onSent?.(r, convId);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_COINS') {
        Alert.alert('Koin tidak cukup', 'Top up koin untuk mengirim gift ini.', [
          { text: 'Nanti', style: 'cancel' },
          { text: 'Top up', onPress: () => (onClose(), router.push('/topup')) },
        ]);
      } else {
        Alert.alert('Gift gagal dikirim', errorMessage(e));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={s.handle} />
        <View style={s.header}>
          <Text style={s.title}>Kirim Gift{hostName ? ` ke ${hostName}` : ''}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.textSub} />
          </Pressable>
        </View>

        <View style={s.tabs}>
          {(
            [
              ['normal', 'Populer'],
              ['luxury', '✨ Mewah'],
            ] as const
          ).map(([k, label]) => (
            <Pressable
              key={k}
              onPress={() => {
                setTab(k);
                setSelected(null);
              }} style={[s.tab, tab === k && s.tabOn]}>
              <Text style={[s.tabText, tab === k && s.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {!gifts ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 60 }} />
        ) : (
          <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={s.grid}>
            {list.map((g) => {
              const on = selected?.id === g.id;
              return (
                <Pressable
                  key={g.id}
                  testID={`gift-${g.id}`}
                  onPress={() => {
                    setSelected(g);
                    Haptics.selectionAsync().catch(() => {});
                  }}
                  style={[s.cell, on && s.cellOn]}
                >
                  {isLuxury(g) ? <Text style={s.lux}>MEWAH</Text> : null}
                  <GiftIcon icon={g.icon} imageUrl={g.imageUrl} size={44} />
                  <Text style={s.name} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <View style={s.priceRow}>
                    <Coin size={11} />
                    <Text style={s.price}>{compact(g.price)}</Text>
                  </View>
                </Pressable>
              );
            })}
            {!list.length ? <Text style={s.empty}>Belum ada gift di kategori ini</Text> : null}
          </ScrollView>
        )}

        <View style={s.counts}>
          {COUNTS.map((c) => (
            <Pressable key={c} onPress={() => setCount(c)} style={[s.count, count === c && s.countOn]}>
              <Text style={[s.countText, count === c && s.countTextOn]}>x{c}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.footer}>
          <Pressable onPress={() => (onClose(), router.push('/topup'))} style={s.balance}>
            <Coin size={16} />
            <Text style={s.balanceText}>{number(coins)}</Text>
            <Text style={s.topup}>Top up ›</Text>
          </Pressable>
          <GradientButton onPress={send} loading={sending} disabled={!selected} style={{ minWidth: 150 }}>
            <Text style={s.sendText}>{selected ? `Kirim · ${compact(total)}` : 'Pilih gift'}</Text>
          </GradientButton>
        </View>
        {selected && !enough ? <Text style={s.warn}>Saldo tidak cukup — top up dulu</Text> : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, flexShrink: 1 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  tabOn: { backgroundColor: colors.primary },
  tabText: { fontWeight: '700', color: colors.textSub },
  tabTextOn: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 6 },
  cell: {
    width: '23%',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surfaceAlt,
    gap: 2,
  },
  cellOn: { borderColor: colors.pink, backgroundColor: '#FFF0F7' },
  lux: { position: 'absolute', top: 4, right: 4, fontSize: 7, fontWeight: '900', color: '#B45309', backgroundColor: '#FDE68A', paddingHorizontal: 3, borderRadius: 4, overflow: 'hidden' },
  name: { fontSize: 12, fontWeight: '700', color: colors.text, maxWidth: '90%' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  price: { fontSize: 11, fontWeight: '700', color: colors.textSub },
  empty: { color: colors.textDim, paddingVertical: 30, textAlign: 'center', width: '100%' },
  counts: { flexDirection: 'row', gap: 8, marginTop: 10 },
  count: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border },
  countOn: { borderColor: colors.primary, backgroundColor: '#F3E8FF' },
  countText: { fontWeight: '800', color: colors.textSub },
  countTextOn: { color: colors.primaryDark },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, gap: 12 },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balanceText: { fontWeight: '800', fontSize: 16, color: colors.text },
  topup: { color: colors.primary, fontWeight: '700', marginLeft: 4 },
  sendText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  warn: { color: colors.danger, fontSize: 12, marginTop: 6, textAlign: 'right' },
});
