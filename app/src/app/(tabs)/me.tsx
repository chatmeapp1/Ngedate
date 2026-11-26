import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import type { ComponentProps } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HostLevelBadge, LevelBadge, VipBadge } from '@/components/Badges';
import { Avatar, Coin } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { versionLabel } from '@/components/UpdateWatcher';
import Constants from 'expo-constants';
import { useAuth } from '@/context/auth';
import { countryName, flag } from '@/lib/countries';
import { number } from '@/lib/format';
import { colors, gradients, radius } from '@/lib/theme';

function Item({ icon, label, onPress, danger }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.item, pressed && { backgroundColor: colors.surfaceAlt }]}>
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.primary} />
      <Text style={[s.itemText, danger && { color: colors.danger }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
    </Pressable>
  );
}

export default function Me() {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshMe } = useAuth();
  useFocusEffect(
    useCallback(() => {
      refreshMe();
    }, [refreshMe])
  );
  if (!user) return null;
  const isHost = user.role === 'host';
  const m = user.membership;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <LinearGradient colors={gradients.header} style={{ paddingTop: insets.top + 20, paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={s.profile}>
          <Avatar uri={user.avatarUrl} name={user.displayName} size={78} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[s.name, { flexShrink: 1 }]} numberOfLines={1}>
                {user.displayName}
              </Text>
              {user.verified ? <Verified size={20} /> : null}
              {m ? (isHost ? <HostLevelBadge level={m.level} size={18} /> : <LevelBadge level={m.level} size={22} />) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <View style={s.idChip}>
                <Text style={s.idLabel}>ID</Text>
                <Text style={s.idValue}>{user.id}</Text>
              </View>
              <Text style={s.meta}>
                {flag(user.countryCode)} {countryName(user.countryCode)}
              </Text>
              {!isHost && m && m.vip > 0 ? <VipBadge vip={m.vip} size={20} /> : null}
            </View>
            {isHost ? (
              <View style={s.hostBadge}>
                <Ionicons name="star" size={12} color="#fff" />
                <Text style={s.hostBadgeText}>Host</Text>
              </View>
            ) : null}
          </View>
        </View>

        {m ? (
          <Pressable onPress={() => router.push('/level')} style={{ marginTop: 18 }}>
            <LinearGradient colors={['#4B3575', '#2B2040']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.levelCard}>
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={s.levelTitle}>Lv {m.level}</Text>
                <Text style={s.levelSub}>
                  {m.nextLevelAt === null
                    ? 'Tingkat tertinggi 👑'
                    : isHost
                      ? `Dapatkan ${number(m.nextLevelAt - m.topupTotal)} 💎 lagi (7 hari terakhir) untuk Lv ${m.level + 1}`
                      : `Top up ${number(m.nextLevelAt - m.topupTotal)} koin lagi untuk Lv ${m.level + 1}`}
                </Text>
                <View style={s.track}>
                  <View style={[s.fill, { width: `${Math.max(3, Math.round(m.levelProgress * 100))}%` }]} />
                </View>
              </View>
              {isHost ? <HostLevelBadge level={m.level} size={26} /> : <LevelBadge level={m.level} size={40} />}
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
            </LinearGradient>
          </Pressable>
        ) : null}

        <View style={s.balances}>
          {!isHost ? (
            <Pressable style={[s.balance, { backgroundColor: '#FFE3F3' }]} onPress={() => router.push('/topup')}>
              <View style={s.balanceHead}>
                <Text style={[s.balanceTitle, { color: colors.pink }]}>Koin</Text>
                <Text style={s.balanceAction}>Top up ›</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Coin size={22} />
                <Text style={s.balanceValue}>{number(user.coins ?? 0)}</Text>
              </View>
            </Pressable>
          ) : null}
          {!isHost ? (
            <Pressable style={[s.balance, { backgroundColor: '#FFF0D6' }]} onPress={() => router.push('/vip')}>
              <View style={s.balanceHead}>
                <Text style={[s.balanceTitle, { color: '#D9801A' }]}>VIP</Text>
                <Text style={s.balanceAction}>{m && m.vip > 0 ? 'Lihat ›' : 'Beli ›'}</Text>
              </View>
              <Text style={[s.vipState, { color: '#B26A00' }]}>
                {m && m.vip > 0 ? `VIP ${m.vip} · ${m.freeCardsLeft} kartu gratis` : 'Terkunci'}
              </Text>
            </Pressable>
          ) : (
            <Pressable style={[s.balance, { backgroundColor: '#E6F4FF' }]} onPress={() => router.push('/wallet')}>
              <View style={s.balanceHead}>
                <Text style={[s.balanceTitle, { color: '#2563EB' }]}>Diamond</Text>
                <Text style={s.balanceAction}>Dompet ›</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 20 }}>💎</Text>
                <Text style={s.balanceValue}>{number(user.diamonds ?? 0)}</Text>
              </View>
            </Pressable>
          )}
        </View>
      </LinearGradient>

      <View style={s.group}>
        <Item icon="person-circle-outline" label="Edit profil" onPress={() => router.push('/edit-profile')} />
        {isHost ? (
          <>
            <Item icon="eye-outline" label="Lihat profil saya" onPress={() => router.push({ pathname: '/host/[id]', params: { id: String(user.id) } })} />
            <Item icon="options-outline" label="Pengaturan host (tarif & WhatsApp)" onPress={() => router.push('/host-settings')} />
            {!user.verified ? (
              <Item
                icon="scan-outline"
                label={user.verificationStatus === 'pending' ? 'Verifikasi wajah (sedang ditinjau)' : 'Verifikasi wajah'}
                onPress={() => router.push('/verification')}
              />
            ) : null}
          </>
        ) : null}
      </View>

      <View style={s.group}>
        <Item icon="settings-outline" label="Pengaturan akun" onPress={() => router.push('/account-settings')} />
        <Item icon="shield-checkmark-outline" label="Pengguna diblokir" onPress={() => router.push('/blocked')} />
        <Item icon="server-outline" label="Alamat server" onPress={() => router.push('/server')} />
        <Item
          icon="log-out-outline"
          label="Keluar"
          danger
          onPress={() =>
            Alert.alert('Keluar', 'Yakin ingin keluar dari akun ini?', [
              { text: 'Batal', style: 'cancel' },
              { text: 'Keluar', style: 'destructive', onPress: logout },
            ])
          }
        />
      </View>
      <Text style={s.version}>{versionLabel(Constants.expoConfig?.version)}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontSize: 22, fontWeight: '900', color: colors.text },
  meta: { color: colors.textSub, fontSize: 13 },
  hostBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.primary, paddingHorizontal: 8, height: 22, borderRadius: radius.pill },
  hostBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  idChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 8, height: 24, borderRadius: radius.pill },
  idLabel: { color: '#F59E5B', fontWeight: '900', fontSize: 12 },
  idValue: { color: colors.textSub, fontWeight: '700', fontSize: 13 },
  levelCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.lg, padding: 16 },
  levelTitle: { color: '#FFE3A8', fontSize: 28, fontWeight: '900' },
  levelSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: '#FFD98A' },
  balances: { flexDirection: 'row', gap: 10, marginTop: 12 },
  balance: { flex: 1, borderRadius: radius.lg, padding: 14, gap: 12, minHeight: 92 },
  balanceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balanceTitle: { fontSize: 18, fontWeight: '900', fontStyle: 'italic' },
  balanceAction: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  balanceValue: { fontSize: 22, fontWeight: '900', color: colors.text },
  vipState: { fontSize: 15, fontWeight: '700' },
  group: { backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 16, borderRadius: radius.md, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 56 },
  itemText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  version: { textAlign: 'center', color: colors.textDim, fontSize: 12, marginTop: 20 },
});
