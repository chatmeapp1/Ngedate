import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Field, GradientButton, ScreenHeader } from '@/components/ui';
import { getServerUrl, setServerUrl } from '@/lib/api';
import { colors } from '@/lib/theme';

// Alamat backend Amora (mis. https://api.amora.app). Bisa diganti tanpa build ulang.
export default function Server() {
  const [url, setUrl] = useState(getServerUrl() || 'https://');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const save = async () => {
    setLoading(true);
    setStatus(null);
    const clean = url.trim().replace(/\/+$/, '');
    try {
      const res = await fetch(`${clean}/health`);
      const data = await res.json();
      if (!data?.ok) throw new Error();
      await setServerUrl(clean);
      setStatus({ ok: true, text: 'Terhubung ✓' });
      setTimeout(() => router.back(), 600);
    } catch {
      setStatus({ ok: false, text: 'Server tidak bisa dihubungi. Periksa alamatnya.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Alamat server" />
      <View style={{ padding: 20, gap: 14 }}>
        <Field
          label="URL backend"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://api.domainanda.com"
        />
        <Text style={{ color: colors.textDim, fontSize: 12 }}>
          Alamat server backend Amora. Untuk pengujian di jaringan lokal bisa memakai http://IP-komputer:3000.
        </Text>
        {status ? <Text style={{ color: status.ok ? colors.online : colors.danger }}>{status.text}</Text> : null}
        <GradientButton title="Simpan & tes koneksi" onPress={save} loading={loading} />
      </View>
    </View>
  );
}
