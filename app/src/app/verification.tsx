import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GhostButton, GradientButton } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api, errorMessage } from '@/lib/api';
import { colors, gradients, radius } from '@/lib/theme';
import type { VerificationChallenge } from '@/lib/types';

const COUNTDOWN = 4;

type Phase = 'intro' | 'capture' | 'review' | 'sending';

/**
 * Verifikasi wajah host: server memberi 3 gerakan acak; aplikasi memotret
 * tiap gerakan langsung dari kamera depan (tanpa galeri) dengan hitung mundur.
 * Admin membandingkan ketiga foto dengan gerakan yang diminta & foto profil.
 */
export default function Verification() {
  const insets = useSafeAreaInsets();
  const { user, refreshMe, logout } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('intro');
  const [challenge, setChallenge] = useState<VerificationChallenge | null>(null);
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(COUNTDOWN);
  const [photos, setPhotos] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);

  const status = user?.verificationStatus ?? 'none';

  useFocusEffect(
    useCallback(() => {
      api
        .get<{ status: string; rejectReason?: string | null }>('/api/onboarding/verification')
        .then((r) => setRejectReason(r.status === 'rejected' ? r.rejectReason ?? null : null))
        .catch(() => {});
    }, [])
  );

  const start = async () => {
    if (!permission?.granted) {
      const p = await requestPermission();
      if (!p.granted) {
        Alert.alert('Izin kamera', 'Verifikasi wajah butuh akses kamera.', [
          { text: 'Batal', style: 'cancel' },
          { text: 'Buka pengaturan', onPress: () => Linking.openSettings() },
        ]);
        return;
      }
    }
    setLoading(true);
    try {
      const ch = await api.post<VerificationChallenge>('/api/onboarding/verification/challenge');
      setChallenge(ch);
      setPhotos([]);
      setIndex(0);
      setCount(COUNTDOWN);
      setReady(false);
      setPhase('capture');
    } catch (e) {
      Alert.alert('Gagal memulai', errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // Hitung mundur lalu potret otomatis untuk setiap gerakan
  useEffect(() => {
    if (phase !== 'capture' || !ready || !challenge) return;
    if (count > 0) {
      const t = setTimeout(() => setCount((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    (async () => {
      try {
        const pic = await camera.current?.takePictureAsync({ quality: 0.6, skipProcessing: false });
        if (cancelled || !pic) return;
        const next = [...photos, pic.uri];
        setPhotos(next);
        if (next.length >= challenge.steps.length) setPhase('review');
        else {
          setIndex(next.length);
          setCount(COUNTDOWN);
        }
      } catch (e) {
        if (!cancelled) {
          Alert.alert('Kamera gagal', errorMessage(e));
          setPhase('intro');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, ready, count, challenge, photos]);

  const send = async () => {
    if (!challenge) return;
    setPhase('sending');
    try {
      const form = new FormData();
      form.append('challengeId', String(challenge.challengeId));
      photos.forEach((uri, i) => form.append('photos', { uri, name: `verif-${i}.jpg`, type: 'image/jpeg' } as unknown as Blob));
      await api.post('/api/onboarding/verification', form);
      await refreshMe();
      setPhase('intro');
    } catch (e) {
      Alert.alert('Gagal mengirim', errorMessage(e));
      setPhase('review');
    }
  };

  // ---------- Sedang ditinjau / sudah lolos ----------
  if (phase === 'intro' && (status === 'pending' || status === 'approved')) {
    const ok = status === 'approved';
    return (
      <View style={[s.center, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <LinearGradient colors={gradients.header} style={StyleSheet.absoluteFill} />
        <View style={[s.bigIcon, { backgroundColor: ok ? '#1D9BF0' : colors.gold }]}>
          <Ionicons name={ok ? 'checkmark' : 'hourglass'} size={48} color="#fff" />
        </View>
        <Text style={s.title}>{ok ? 'Verifikasi berhasil' : 'Sedang ditinjau'}</Text>
        <Text style={s.desc}>
          {ok
            ? 'Akunmu sudah mendapat centang biru dan tampil di daftar host.'
            : 'Tim kami sedang memeriksa foto verifikasimu. Biasanya selesai dalam 1×24 jam. Profilmu akan tampil di daftar host setelah disetujui.'}
        </Text>
        <GradientButton title="Ke Beranda" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch', marginTop: 24 }} />
      </View>
    );
  }

  // ---------- Kamera ----------
  if (phase === 'capture' && challenge) {
    const step = challenge.steps[index];
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" mirror onCameraReady={() => setReady(true)} />
        <View style={[s.camTop, { paddingTop: insets.top + 12 }]}>
          <Pressable hitSlop={10} onPress={() => setPhase('intro')}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <Text style={s.camStep}>
            Gerakan {index + 1} dari {challenge.steps.length}
          </Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={s.oval} pointerEvents="none" />
        <View style={[s.camBottom, { paddingBottom: insets.bottom + 28 }]}>
          <Text style={s.instruction}>{step.text}</Text>
          <View style={s.countCircle}>
            {ready ? <Text style={s.count}>{count > 0 ? count : '📸'}</Text> : <ActivityIndicator color="#fff" />}
          </View>
        </View>
      </View>
    );
  }

  // ---------- Periksa foto ----------
  if ((phase === 'review' || phase === 'sending') && challenge) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 12 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: insets.bottom + 140 }}>
          <Text style={s.title}>Periksa foto</Text>
          <Text style={s.descLeft}>Pastikan wajahmu terlihat jelas dan gerakan sesuai instruksi.</Text>
          {challenge.steps.map((st, i) => (
            <View key={st.key} style={s.reviewRow}>
              {photos[i] ? <Image source={{ uri: photos[i] }} style={s.reviewImg} contentFit="cover" /> : null}
              <View style={{ flex: 1 }}>
                <Text style={s.reviewNo}>Gerakan {i + 1}</Text>
                <Text style={s.reviewText}>{st.text}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
          <GradientButton title="Kirim untuk ditinjau" onPress={send} loading={phase === 'sending'} />
          <GhostButton title="Ulangi dengan gerakan baru" onPress={start} />
        </View>
      </View>
    );
  }

  // ---------- Pengantar ----------
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <LinearGradient colors={gradients.header} style={StyleSheet.absoluteFill} />
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 32, gap: 16, paddingBottom: insets.bottom + 160 }}>
        <View style={[s.bigIcon, { backgroundColor: '#1D9BF0', alignSelf: 'center' }]}>
          <Ionicons name="scan" size={44} color="#fff" />
        </View>
        <Text style={[s.title, { textAlign: 'center' }]}>Verifikasi wajah</Text>
        <Text style={s.desc}>
          Buktikan kamu orang asli untuk mendapat <Text style={{ fontWeight: '800', color: '#1D9BF0' }}>centang biru</Text> dan tampil di daftar host.
        </Text>
        {status === 'rejected' ? (
          <View style={s.rejected}>
            <Ionicons name="alert-circle" size={20} color={colors.danger} />
            <Text style={{ flex: 1, color: colors.danger }}>Verifikasi sebelumnya ditolak{rejectReason ? `: ${rejectReason}` : ''}. Silakan ulangi.</Text>
          </View>
        ) : null}
        <View style={s.tips}>
          {[
            ['sunny-outline', 'Cari tempat dengan cahaya terang'],
            ['glasses-outline', 'Lepas masker & kacamata hitam'],
            ['hand-left-outline', 'Ikuti 3 gerakan acak yang muncul di layar'],
            ['camera-outline', 'Foto diambil otomatis dari kamera depan'],
          ].map(([icon, text]) => (
            <View key={text} style={s.tip}>
              <Ionicons name={icon as 'sunny-outline'} size={22} color={colors.primary} />
              <Text style={s.tipText}>{text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <GradientButton title="Mulai verifikasi" icon="camera" onPress={start} loading={loading} />
        <GhostButton
          title="Keluar"
          onPress={() =>
            Alert.alert('Keluar', 'Keluar dari akun ini?', [
              { text: 'Batal', style: 'cancel' },
              { text: 'Keluar', style: 'destructive', onPress: logout },
            ])
          }
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  bigIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '900', color: colors.text },
  desc: { color: colors.textSub, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  descLeft: { color: colors.textSub, fontSize: 14, lineHeight: 20 },
  rejected: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: '#FEE2E2' },
  tips: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 14 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tipText: { flex: 1, color: colors.text, fontSize: 15 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 12, backgroundColor: 'rgba(255,247,251,0.95)' },
  camTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  camStep: { color: '#fff', fontWeight: '800', fontSize: 16 },
  oval: {
    position: 'absolute',
    alignSelf: 'center',
    top: '18%',
    width: '72%',
    aspectRatio: 0.78,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  camBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 16, paddingHorizontal: 24, backgroundColor: 'rgba(0,0,0,0.45)', paddingTop: 20 },
  instruction: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  countCircle: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  count: { color: '#fff', fontSize: 30, fontWeight: '900' },
  reviewRow: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: colors.surface, padding: 10, borderRadius: radius.md },
  reviewImg: { width: 90, height: 120, borderRadius: radius.sm },
  reviewNo: { color: colors.textDim, fontWeight: '700', fontSize: 12 },
  reviewText: { color: colors.text, fontWeight: '700', fontSize: 15, marginTop: 2 },
});
