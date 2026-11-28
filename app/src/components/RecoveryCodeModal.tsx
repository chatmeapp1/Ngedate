import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { GradientButton } from '@/components/ui';
import { colors, radius } from '@/lib/theme';

/** Menampilkan kode pemulihan SEKALI. Pengguna diminta menyimpannya (disalin atau difoto). */
export function RecoveryCodeModal({ code, onClose }: { code: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <View style={s.icon}>
            <Ionicons name="key" size={26} color="#fff" />
          </View>
          <Text style={s.title}>Simpan kode pemulihan</Text>
          <Text style={s.body}>Kode ini dipakai untuk masuk lagi jika kamu lupa password. Kode hanya ditampilkan sekali. Simpan di tempat aman, jangan dibagikan ke siapa pun.</Text>
          <Pressable onPress={copy} style={s.codeBox}>
            <Text style={s.code} selectable>
              {code}
            </Text>
            <View style={s.copyRow}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.primaryDark} />
              <Text style={s.copyText}>{copied ? 'Tersalin' : 'Salin kode'}</Text>
            </View>
          </Pressable>
          <GradientButton title="Sudah saya simpan" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: radius.lg, padding: 22, gap: 14, alignItems: 'stretch' },
  icon: { alignSelf: 'center', width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },
  body: { textAlign: 'center', color: colors.textSub, fontSize: 13.5, lineHeight: 20 },
  codeBox: { alignItems: 'center', gap: 8, paddingVertical: 16, borderRadius: radius.md, backgroundColor: '#F3EEFF', borderWidth: 1, borderColor: '#DCCEFF' },
  code: { fontSize: 24, fontWeight: '700', letterSpacing: 2, color: colors.primaryDark },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  copyText: { color: colors.primaryDark, fontWeight: '600', fontSize: 13 },
});
