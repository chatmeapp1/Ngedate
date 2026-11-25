import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '@/lib/theme';

const CHECK_EVERY_MS = 10 * 60 * 1000; // jangan cek lebih sering dari 10 menit

/**
 * Update OTA: cek versi baru saat aplikasi dibuka / kembali dari background.
 * Kalau ada, unduh di belakang layar lalu tampilkan banner "Mulai ulang".
 */
export function UpdateWatcher() {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const lastCheck = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    // Tidak aktif di mode pengembangan / pratinjau web
    if (__DEV__ || !Updates.isEnabled) return;

    const check = async () => {
      if (busy.current || Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
      busy.current = true;
      lastCheck.current = Date.now();
      try {
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) {
          await Updates.fetchUpdateAsync();
          setReady(true);
        }
      } catch {
        // tanpa internet / server update tidak bisa dihubungi: abaikan
      } finally {
        busy.current = false;
      }
    };

    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, []);

  if (!ready) return null;

  return (
    <View style={[s.wrap, { bottom: insets.bottom + 76 }]} pointerEvents="box-none">
      <View style={s.banner}>
        <Ionicons name="sparkles" size={20} color="#fff" />
        <Text style={s.text}>Versi baru Amora sudah siap</Text>
        <Pressable onPress={() => Updates.reloadAsync().catch(() => {})} style={s.btn}>
          <Text style={s.btnText}>Mulai ulang</Text>
        </Pressable>
        <Pressable hitSlop={8} onPress={() => setReady(false)}>
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.8)" />
        </Pressable>
      </View>
    </View>
  );
}

// Info versi untuk ditampilkan di menu Saya (membantu saat melaporkan masalah)
export function versionLabel(appVersion?: string) {
  const id = Updates.updateId ? Updates.updateId.slice(0, 8) : 'bawaan';
  return `Versi ${appVersion ?? '?'} · update ${id}`;
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  text: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 14 },
  btn: { backgroundColor: colors.pink, paddingHorizontal: 12, height: 32, borderRadius: radius.pill, justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
