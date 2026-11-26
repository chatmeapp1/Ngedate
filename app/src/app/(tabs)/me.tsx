import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const { user, logout } = useAuth();
  if (!user) return null;
  const isHost = user.role === 'host';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <LinearGradient colors={gradients.header} style={{ paddingTop: insets.top + 20, paddingHorizontal: 16, paddingBottom: 20 }}>
        <View style={s.profile}>
          <Avatar uri={user.avatarUrl} name={user.displayName} size={76} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[s.name, { flexShrink: 1 }]} numberOfLines={1}>
                {user.displayName}
              </Text>
              {user.verified ? <Verified size={20} /> : null}
            </View>
            <Text style={s.meta}>
              ID {user.id} · {flag(user.countryCode)} {countryName(user.countryCode)}
            </Text>
            {isHost ? (
              <View style={s.hostBadge}>
                <Ionicons name="star" size={12} color="#fff" />
                <Text style={s.hostBadgeText}>Host</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={s.balances}>
          <Pressable style={s.balance} onPress={() => router.push('/wallet')}>
            <Coin size={20} />
            <Text style={s.balanceValue}>{number(user.coins ?? 0)}</Text>
            <Text style={s.balanceLabel}>Koin</Text>
          </Pressable>
          {isHost ? (
            <Pressable style={s.balance} onPress={() => router.push('/wallet')}>
              <Text style={{ fontSize: 18 }}>💎</Text>
              <Text style={s.balanceValue}>{number(user.diamonds ?? 0)}</Text>
              <Text style={s.balanceLabel}>Diamond</Text>
            </Pressable>
          ) : null}
        </View>
      </LinearGradient>

      <View style={s.group}>
        <Item icon="person-circle-outline" label="Edit profil" onPress={() => router.push('/edit-profile')} />
        {isHost ? (
          <>
            <Item icon="eye-outline" label="Lihat profil saya" onPress={() => router.push({ pathname: '/host/[id]', params: { id: String(user.id) } })} />
            <Item icon="options-outline" label="Pengaturan host (tarif & WhatsApp)" onPress={() => router.push('/host-settings')} />
            <Item icon="cash-outline" label="Tarik diamond" onPress={() => router.push('/withdraw')} />
            {!user.verified ? (
              <Item
                icon="scan-outline"
                label={user.verificationStatus === 'pending' ? 'Verifikasi wajah (sedang ditinjau)' : 'Verifikasi wajah'}
                onPress={() => router.push('/verification')}
              />
            ) : null}
          </>
        ) : null}
        <Item icon="wallet-outline" label="Dompet" onPress={() => router.push('/wallet')} />
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
  balances: { flexDirection: 'row', gap: 10, marginTop: 18 },
  balance: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, alignItems: 'center', gap: 4 },
  balanceValue: { fontSize: 20, fontWeight: '900', color: colors.text },
  balanceLabel: { color: colors.textSub, fontSize: 12, fontWeight: '600' },
  group: { backgroundColor: colors.surface, marginHorizontal: 16, marginTop: 16, borderRadius: radius.md, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 56 },
  itemText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  version: { textAlign: 'center', color: colors.textDim, fontSize: 12, marginTop: 20 },
});
