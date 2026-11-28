import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openCheckin } from '@/components/CheckinModal';
import { Coin, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/auth';
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

function Item({ badge, dim, children }: { badge?: string; dim?: boolean; children: React.ReactNode }) {
  return (
    <View style={[s.item, dim && { opacity: 0.55 }]}>
      {children}
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Ransel saya: barang dari check-in harian (kartu obrolan & bingkai avatar). */
export default function Backpack() {
  const { user, refreshMe } = useAuth();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    refreshMe();
  }, [refreshMe]);
  if (!user) return null;
  const m = user.membership;
  const cards = m?.checkinCards ?? 0;
  const frame = m?.checkinFrame ?? 0;
  const expired = m?.checkinFrameExpired ?? 0;
  const frameNo = frame || expired;

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

        {frameNo > 0 ? (
          <Item badge={frame ? 'Dipakai' : 'Kedaluwarsa'} dim={!frame}>
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
        ) : (
          <Item dim>
            <View style={s.iconBox}>
              <Ionicons name="sparkles" size={32} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>Frame avatar</Text>
              <Text style={s.desc}>Belum punya. Dapatkan dari check-in harian.</Text>
            </View>
          </Item>
        )}
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
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
