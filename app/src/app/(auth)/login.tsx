import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoBackground } from '@/components/VideoBackground';
import { useAuth } from '@/context/auth';
import { errorMessage, getServerUrl } from '@/lib/api';
import { radius } from '@/lib/theme';

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { quickLogin } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  // Wajib centang persetujuan dulu; kalau belum, kotak centang digoyang
  const requireConsent = () => {
    if (agreed) return true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    Animated.sequence(
      [10, -10, 8, -8, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 60, useNativeDriver: true }))
    ).start();
    return false;
  };

  const onQuick = async () => {
    if (!requireConsent()) return;
    if (!getServerUrl()) {
      router.push('/server');
      return;
    }
    setLoading(true);
    try {
      await quickLogin();
    } catch (e) {
      Alert.alert('Gagal masuk', errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const onAccount = () => {
    if (requireConsent()) router.push('/account');
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#1A0B2E' }}>
      <VideoBackground />

      <Pressable style={[s.serverBtn, { top: insets.top + 10 }]} onPress={() => router.push('/server')} hitSlop={10}>
        <Ionicons name="settings-outline" size={22} color="rgba(255,255,255,0.9)" />
      </Pressable>

      <View style={s.brand}>
        <LinearGradient colors={['#A855F7', '#EC4899']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.logo}>
          <Ionicons name="chatbubble" size={58} color="#fff" style={{ position: 'absolute' }} />
          <Ionicons name="heart" size={26} color="#EC4899" style={{ marginBottom: 6 }} />
        </LinearGradient>
        <Text style={s.appName}>Amora</Text>
        <Text style={s.tagline}>Ngobrol seru dengan teman baru</Text>
      </View>

      <View style={[s.actions, { paddingBottom: insets.bottom + 20 }]}>
        <Pressable onPress={onQuick} disabled={loading} style={({ pressed }) => pressed && { opacity: 0.85 }}>
          <LinearGradient colors={['#EC4899', '#D946EF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btn}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <View style={s.btnIcon}>
                  <Ionicons name="flash" size={22} color="#fff" />
                </View>
                <Text style={s.btnText}>Login cepat</Text>
              </>
            )}
          </LinearGradient>
        </Pressable>

        <Pressable onPress={onAccount} style={({ pressed }) => [s.btn, s.btnDark, pressed && { opacity: 0.85 }]}>
          <View style={s.btnIcon}>
            <Ionicons name="person-circle-outline" size={26} color="#fff" />
          </View>
          <Text style={s.btnText}>Login via Akun</Text>
        </Pressable>

        <Animated.View style={[s.consent, { transform: [{ translateX: shake }] }]}>
          <Pressable onPress={() => setAgreed((v) => !v)} hitSlop={10} style={[s.check, agreed && s.checkOn]}>
            {agreed ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
          </Pressable>
          <Text style={s.consentText}>
            Saya berusia 18 tahun ke atas dan menyetujui{' '}
            <Link href="/privacy" style={s.link}>
              Kebijakan Privasi
            </Link>{' '}
            serta{' '}
            <Link href="/terms" style={s.link}>
              Ketentuan Layanan
            </Link>
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  serverBtn: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  brand: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 40 },
  logo: {
    width: 112,
    height: 112,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EC4899',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  appName: { color: '#fff', fontSize: 46, fontWeight: '900', marginTop: 18, letterSpacing: -1 },
  tagline: { color: 'rgba(255,255,255,0.85)', fontSize: 15, textAlign: 'center', marginTop: 6 },
  actions: { paddingHorizontal: 28, gap: 14 },
  btn: {
    height: 60,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDark: { backgroundColor: 'rgba(10,6,20,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  btnIcon: { position: 'absolute', left: 20 },
  btnText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 6, paddingHorizontal: 4 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkOn: { backgroundColor: '#EC4899', borderColor: '#EC4899' },
  consentText: { flex: 1, color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 19 },
  link: { color: '#fff', textDecorationLine: 'underline', fontWeight: '700' },
});
