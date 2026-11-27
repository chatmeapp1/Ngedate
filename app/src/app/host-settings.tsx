import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, GradientButton, Loading, ScreenHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { number } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import type { HostSettings } from '@/lib/types';

const digits = (v: string) => v.replace(/\D/g, '');

export default function HostSettingsScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<HostSettings | null>(null);
  const [price, setPrice] = useState('');
  const [waEnabled, setWaEnabled] = useState(false);
  const [waNumber, setWaNumber] = useState('');
  const [threshold, setThreshold] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<HostSettings>('/api/host/settings')
      .then((d) => {
        setData(d);
        setPrice(String(d.chatPrice));
        setWaEnabled(d.waEnabled);
        setWaNumber(d.waNumber ?? '');
        setThreshold(String(d.waUnlockThreshold));
      })
      .catch((e) => Alert.alert('Gagal memuat', errorMessage(e)));
  }, []);

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title="Pengaturan host" />
        <Loading />
      </View>
    );
  }

  const { limits } = data;

  const save = async () => {
    setSaving(true);
    try {
      const d = await api.patch<Omit<HostSettings, 'limits'>>('/api/host/settings', {
        chatPrice: Number(price || 0),
        waUnlockThreshold: Number(threshold || 0),
        waEnabled,
        ...(waNumber.trim() ? { waNumber: waNumber.trim() } : {}),
      });
      setData({ ...data, ...d });
      Alert.alert('Tersimpan', 'Pengaturan host diperbarui');
    } catch (e) {
      Alert.alert('Gagal menyimpan', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Pengaturan host" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.cardTitle}>Tarif chat</Text>
          <Field
            label={`Koin per pesan (${number(limits.chatPriceMin)} – ${number(limits.chatPriceMax)})`}
            value={price}
            onChangeText={(v) => setPrice(digits(v))}
            keyboardType="number-pad"
          />
          <Text style={s.hint}>
            Koin user ditahan saat mengirim pesan dan masuk ke penghasilanmu setelah kamu membalas. Jika tidak dibalas dalam 24 jam, koin dikembalikan ke user.
          </Text>
        </View>

        <View style={s.card}>
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>Buka nomor WhatsApp</Text>
              <Text style={s.hint}>User bisa melihat nomormu setelah total gift darinya mencapai syarat.</Text>
            </View>
            <Switch value={waEnabled} onValueChange={setWaEnabled} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
          </View>
          <Field label="Nomor WhatsApp" value={waNumber} onChangeText={setWaNumber} keyboardType="phone-pad" placeholder="08123456789" />
          <Field
            label={`Syarat total gift (${number(limits.waThresholdMin)} – ${number(limits.waThresholdMax)} koin)`}
            value={threshold}
            onChangeText={(v) => setThreshold(digits(v))}
            keyboardType="number-pad"
          />
          <Text style={s.hint}>Nomor tidak pernah ditampilkan di profil atau daftar host, hanya ke user yang sudah memenuhi syarat.</Text>
        </View>

        <GradientButton title="Simpan" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 16, gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
