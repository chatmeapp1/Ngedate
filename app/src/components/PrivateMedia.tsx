import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Coin } from '@/components/ui';
import { number } from '@/lib/format';
import { colors, gradients, radius } from '@/lib/theme';

/** Kartu foto/video privat yang masih terkunci (tampilan pengguna): ketuk untuk membuka dengan koin. */
export function LockedMedia({ type, price, busy, onUnlock }: { type: 'image' | 'video'; price: number; busy: boolean; onUnlock: () => void }) {
  return (
    <Pressable onPress={onUnlock} disabled={busy} style={s.locked}>
      <LinearGradient colors={['#3B2A63', '#1F1535']} style={[StyleSheet.absoluteFill, s.center]}>
        <View style={s.lockCircle}>
          <Ionicons name="lock-closed" size={26} color="#fff" />
        </View>
        <Text style={s.lockTitle}>{type === 'image' ? 'Foto privat' : 'Video privat'}</Text>
        <View style={s.openBtn}>
          {busy ? (
            <ActivityIndicator size="small" color="#5B3A00" />
          ) : (
            <>
              <Text style={s.openText}>Buka · </Text>
              <Coin size={14} />
              <Text style={s.openText}> {number(price)}</Text>
            </>
          )}
        </View>
      </LinearGradient>
    </Pressable>
  );
}

/** Lembar untuk host: pilih foto atau video, tentukan harga buka (koin), lalu lanjut memilih file. */
export function PrivateMediaSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (kind: 'image' | 'video', price: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const [price, setPrice] = useState('500');
  const value = Math.max(0, Math.floor(Number(price.replace(/\D/g, '')) || 0));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={s.grabber} />
        <Text style={s.title}>Kirim foto / video privat</Text>
        <Text style={s.sub}>Pengguna harus membayar koin untuk membukanya. Kamu menerima bagian seperti gift.</Text>

        <View style={s.kinds}>
          {(
            [
              ['image', 'image-outline', 'Foto'],
              ['video', 'videocam-outline', 'Video (maks 5 menit)'],
            ] as const
          ).map(([k, icon, label]) => (
            <Pressable key={k} onPress={() => setKind(k)} style={[s.kind, kind === k && s.kindOn]}>
              <Ionicons name={icon} size={20} color={kind === k ? '#fff' : colors.primary} />
              <Text style={[s.kindText, kind === k && { color: '#fff' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>Harga buka (koin)</Text>
        <View style={s.priceBox}>
          <Coin size={18} />
          <TextInput value={price} onChangeText={setPrice} keyboardType="number-pad" style={s.priceInput} maxLength={9} />
        </View>
        <View style={s.chips}>
          {[0, 100, 500, 1000, 5000].map((p) => (
            <Pressable key={p} onPress={() => setPrice(String(p))} style={[s.chip, value === p && s.chipOn]}>
              <Text style={[s.chipText, value === p && { color: '#fff' }]}>{p === 0 ? 'Gratis' : number(p)}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => {
            onClose();
            onPick(kind, value);
          }}
        >
          <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.cta}>
            <Text style={s.ctaText}>Pilih {kind === 'image' ? 'foto' : 'video'}</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  locked: { width: 210, height: 260, borderRadius: radius.md, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  lockCircle: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  lockTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  openBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFD98A', paddingHorizontal: 16, height: 34, borderRadius: radius.pill },
  openText: { color: '#5B3A00', fontWeight: '800', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 10 },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 4 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  sub: { color: colors.textSub, fontSize: 13 },
  kinds: { flexDirection: 'row', gap: 10, marginTop: 6 },
  kind: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border },
  kindOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  label: { color: colors.textSub, fontWeight: '700', fontSize: 13, marginTop: 6 },
  priceBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, height: 48 },
  priceInput: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.primary },
  chipText: { color: colors.textSub, fontWeight: '700', fontSize: 13 },
  cta: { height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
