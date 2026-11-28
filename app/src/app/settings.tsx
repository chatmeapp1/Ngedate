import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function Row({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={22} color={colors.text} />
      <Text style={s.label}>{label}</Text>
      <Ionicons name="arrow-forward" size={18} color={colors.textDim} />
    </Pressable>
  );
}

/** Pengaturan sistem: daftar menu, tiap menu membuka halamannya sendiri. */
export default function SystemSettings() {
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();

  const help = async () => {
    try {
      const r = await api.get<{ whatsapp: string | null }>('/api/auth/support');
      if (!r.whatsapp) throw new Error('no contact');
      await Linking.openURL(`https://wa.me/${r.whatsapp}`);
    } catch {
      Alert.alert('Bantuan & umpan balik', 'Kontak admin belum tersedia. Coba lagi nanti.');
    }
  };

  const confirmLogout = () =>
    Alert.alert('Keluar', 'Yakin ingin keluar dari akun ini?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Keluar', style: 'destructive', onPress: logout },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Pengaturan sistem" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}>
        <Row icon="globe-outline" label="Bahasa app" onPress={() => router.push('/language')} />
        <Row icon="shield-outline" label="Pengaturan akun" onPress={() => router.push('/account-settings')} />
        <Row icon="ban-outline" label="Daftar hitam" onPress={() => router.push('/blocked')} />
        <Row icon="help-circle-outline" label="Bantuan & umpan balik" onPress={help} />
        <Row icon="server-outline" label="Alamat server" onPress={() => router.push('/server')} />
      </ScrollView>
      <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
        <Pressable onPress={confirmLogout} style={({ pressed }) => [s.logout, pressed && { opacity: 0.7 }]}>
          <Text style={s.logoutText}>Keluar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 18 },
  label: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  logout: { backgroundColor: colors.surface, borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  logoutText: { fontSize: 16, fontWeight: '700', color: colors.danger },
});
