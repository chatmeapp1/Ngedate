import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openCheckin } from '@/components/CheckinModal';
import { Coin, ScreenHeader } from '@/components/ui';
import { FRAMES } from '@/components/FramedAvatar';
import { useAuth } from '@/context/auth';
import { api, errorMessage } from '@/lib/api';
import { number } from '@/lib/format';
import { colors } from '@/lib/theme';

const FRAME_IMG = [require('../../assets/vip/ci1.png'), require('../../assets/vip/ci2.png')];

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
function left(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms >= DAY) return `${Math.ceil(ms / DAY)} hari lagi`;
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `${h} jam lagi` : `${Math.max(1, Math.ceil(ms / 60000))} menit lagi`;
}

function Item({ badge, dim, onBadge, busy, children }: { badge?: string; dim?: boolean; onBadge?: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <View style={[s.item, dim && { opacity: 0.55 }]}>
      {children}
      {badge ? (
        <Pressable disabled={!onBadge || busy} onPress={onBadge} style={[s.badge, onBadge && s.badgeAction]}>
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.badgeText}>{badge}</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

/** Ransel saya: barang dari check-in harian (kartu obrolan & bingkai avatar). */
export default function Backpack() {
  const { user, refreshMe } = useAuth();
  const insets = useSafeAreaInsets();
  const [switching, setSwitching] = useState<'vip' | 'checkin' | null>(null);
  useEffect(() => {
    refreshMe();
  }, [refreshMe]);
  if (!user) return null;
  const m = user.membership;
  const cards = m?.checkinCards ?? 0;
  const vip = m?.vip ?? 0;
  const frame = m?.checkinFrame ?? 0;
  const expired = m?.checkinFrameExpired ?? 0;
  const frameNo = frame || expired;
  const worn = m?.frameWorn ?? null;

  // Hanya satu bingkai yang terpasang di avatar: ketuk "Pakai" untuk menukar
  const wear = async (choice: 'vip' | 'checkin') => {
    setSwitching(choice);
    try {
      await api.post('/api/me/frame', { choice });
      await refreshMe();
    } catch (e) {
      Alert.alert('Gagal menukar bingkai', errorMessage(e));
    } finally {
      setSwitching(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Ransel saya" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 24 }}>
        <View style={s.balance}>
          <Text style={s.balanceLabel}>Koin saya</Text>
          <Coin size={22} />
          <Text style={s.balanceValue}>{number(user.coins ?? 0)}</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => router.push('/topup')} style={s.topup}>
            <Text style={s.topupText}>Top up</Text>
          </Pressable>
        </View>

        <View style={s.head}>
          <Text style={s.title}>Properti</Text>
          <Pressable onPress={openCheckin} style={s.free} hitSlop={8}>
            <Text style={s.freeText}>Dapatkan properti gratis</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSub} />
          </Pressable>
        </View>

        <Item badge={`x${cards}`} dim={cards === 0}>
          <View style={s.iconBox}>
            <Ionicons name="chatbubble-ellipses" size={34} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>Kartu obrolan</Text>
            <Text style={s.desc}>Ngobrol dengan orang lain secara gratis</Text>
          </View>
        </Item>

        {vip > 0 ? (
          <Item badge={worn === 'vip' ? 'Dipakai' : 'Pakai'} onBadge={worn === 'vip' ? undefined : () => wear('vip')} busy={switching === 'vip'}>
            <View style={s.frameBox}>
              <Image source={FRAMES[Math.min(vip, FRAMES.length) - 1].src} contentFit="contain" style={{ width: 76, height: 76 }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>Frame VIP {vip}</Text>
              <Text style={s.desc}>Berlaku selama kamu VIP</Text>
            </View>
          </Item>
        ) : null}

        {frameNo > 0 ? (
          <Item
            badge={frame ? (worn === 'checkin' ? 'Dipakai' : 'Pakai') : 'Kedaluwarsa'}
            dim={!frame}
            onBadge={frame && worn !== 'checkin' ? () => wear('checkin') : undefined}
            busy={switching === 'checkin'}
          >
            <View style={s.frameBox}>
              <Image source={FRAME_IMG[Math.min(frameNo, FRAME_IMG.length) - 1]} contentFit="contain" style={{ width: 76, height: 76 }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>Frame avatar {frameNo}</Text>
              {frame && m?.checkinFrameUntil ? (
                <>
                  <Text style={s.desc}>Berlaku sampai {fmtDate(m.checkinFrameUntil)}</Text>
                  <Text style={s.left}>{left(m.checkinFrameUntil)}</Text>
                </>
              ) : (
                <Text style={s.desc}>Berakhir {m?.checkinFrameExpiredAt ? fmtDate(m.checkinFrameExpiredAt) : ''}</Text>
              )}
            </View>
          </Item>
        ) : vip === 0 ? (
          <Item dim>
            <View style={s.iconBox}>
              <Ionicons name="sparkles" size={32} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>Frame avatar</Text>
              <Text style={s.desc}>Belum punya. Dapatkan dari check-in harian.</Text>
            </View>
          </Item>
        ) : null}

        {vip > 0 && frame > 0 ? <Text style={s.note}>Hanya satu frame yang terpasang di avatar. Ketuk "Pakai" untuk menukar.</Text> : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  balance: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 16 },
  balanceLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  balanceValue: { fontSize: 24, fontWeight: '800', color: colors.text },
  topup: { backgroundColor: '#F59E0B', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  topupText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  free: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  freeText: { fontSize: 13.5, fontWeight: '600', color: colors.textSub },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 18, overflow: 'hidden' },
  iconBox: { width: 76, height: 76, borderRadius: 18, backgroundColor: '#FB923C', alignItems: 'center', justifyContent: 'center' },
  frameBox: { width: 76, height: 76, borderRadius: 18, backgroundColor: '#F3E8FF', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 17, fontWeight: '800', color: colors.text },
  desc: { fontSize: 13.5, color: colors.textSub, marginTop: 3, lineHeight: 19 },
  left: { fontSize: 13, color: colors.primaryDark, fontWeight: '700', marginTop: 2 },
  badge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#A855F7', borderBottomLeftRadius: 16, paddingHorizontal: 18, paddingVertical: 5 },
  badgeAction: { backgroundColor: '#F59E0B', minWidth: 74, alignItems: 'center' },
  note: { fontSize: 12.5, color: colors.textSub, textAlign: 'center', marginTop: 2 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
