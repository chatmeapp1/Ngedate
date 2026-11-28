import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton, ScreenHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { onRealtime } from '@/lib/realtime';
import { colors, radius } from '@/lib/theme';
import type { LiveCurrent, LiveIngest } from '@/lib/types';

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(!secret);
  return (
    <View style={s.copyBox}>
      <Text style={s.copyLabel}>{label}</Text>
      <View style={s.copyRow}>
        <Text style={s.copyValue} selectable numberOfLines={2}>
          {show ? value : '••••••••••••••••••••••••••••'}
        </Text>
        {secret ? (
          <Pressable onPress={() => setShow((x) => !x)} hitSlop={8}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSub} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={async () => {
            await Clipboard.setStringAsync(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
          style={s.copyBtn}
          hitSlop={8}
        >
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.primaryDark} />
          <Text style={s.copyBtnText}>{copied ? 'Tersalin' : 'Salin'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Host: mulai/akhiri live. Siaran dikirim dari aplikasi RTMP (OBS, Larix, Streamlabs) memakai alamat dan kunci di sini. */
export default function LiveHost() {
  const insets = useSafeAreaInsets();
  const [cur, setCur] = useState<LiveCurrent | null | undefined>(undefined);
  const [ingest, setIngest] = useState<LiveIngest | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ current: LiveCurrent | null }>('/api/live/mine');
      setCur(r.current);
      if (!r.current) setIngest(null);
    } catch {
      setCur((c) => (c === undefined ? null : c));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    const off = [onRealtime('live:started', load), onRealtime('live:ended', load)];
    return () => {
      clearInterval(t);
      off.forEach((f) => f());
    };
  }, [load]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.post<LiveIngest>('/api/live/start', { title: title.trim() });
      setIngest(r);
      await load();
    } catch (e) {
      Alert.alert('Tidak bisa memulai live', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = () =>
    Alert.alert('Akhiri live?', 'Penonton akan keluar dari siaranmu.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Akhiri',
        style: 'destructive',
        onPress: async () => {
          if (!cur) return;
          try {
            await api.post(`/api/live/${cur.id}/end`);
          } catch (e) {
            Alert.alert('Gagal', errorMessage(e));
          }
          setIngest(null);
          load();
        },
      },
    ]);

  const localOnly = ingest ? /127\.0\.0\.1|localhost/.test(ingest.rtmpUrl) : false;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Live" />
      {cur === undefined ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
          {cur ? (
            <View style={s.status}>
              <View style={[s.badge, cur.status === 'live' ? (cur.disconnected ? s.badgeWarn : s.badgeLive) : s.badgeWait]}>
                <Text style={s.badgeText}>{cur.status === 'live' ? (cur.disconnected ? 'TERPUTUS' : 'LIVE') : 'MENUNGGU SIARAN'}</Text>
              </View>
              <Text style={s.statusTitle}>{cur.title || 'Live tanpa judul'}</Text>
              <View style={s.views}>
                <Ionicons name="eye" size={16} color={colors.textSub} />
                <Text style={s.viewsText}>{cur.viewers} penonton</Text>
              </View>
              {cur.status === 'waiting' ? <Text style={s.hint}>Mulai siaran dari aplikasi RTMP kamu. Live akan muncul di daftar begitu video masuk.</Text> : null}
              {cur.disconnected ? <Text style={[s.hint, { color: '#B45309' }]}>Siaran terputus. Sambungkan lagi dalam 30 detik, kalau tidak live berakhir otomatis.</Text> : null}
            </View>
          ) : (
            <View style={s.card}>
              <Text style={s.h}>Judul live (opsional)</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder="Mis. Ngobrol santai malam ini" placeholderTextColor={colors.textDim} maxLength={60} style={s.input} />
              <GradientButton title="Mulai siaran" onPress={start} loading={busy} />
              <Text style={s.hint}>Hanya host yang sudah verifikasi wajah yang bisa live. Dilarang membagikan nomor HP, link, atau konten tidak pantas.</Text>
            </View>
          )}

          {cur ? (
            <View style={s.card}>
              <Text style={s.h}>Cara menyiarkan</Text>
              <Text style={s.step}>1. Buka aplikasi siaran RTMP, mis. Larix Broadcaster, Streamlabs, atau OBS.</Text>
              <Text style={s.step}>2. Isi alamat server dan kunci siaran di bawah.</Text>
              <Text style={s.step}>3. Tekan mulai siaran. Live akan tampil di Amora dalam beberapa detik.</Text>
              {ingest ? (
                <>
                  <CopyRow label="Alamat server (URL)" value={ingest.rtmpUrl} />
                  <CopyRow label="Kunci siaran (rahasia)" value={ingest.streamKey} secret />
                  {localOnly ? <Text style={[s.hint, { color: '#B45309' }]}>Alamat ini hanya bisa dipakai di perangkat server. Minta admin mengatur alamat RTMP publik (LIVE_RTMP_PUBLIC).</Text> : null}
                </>
              ) : (
                <>
                  <Text style={s.hint}>Kunci siaran hanya tampil sekali. Kalau hilang, buat kunci baru.</Text>
                  {cur.status === 'waiting' ? <GradientButton title="Buat kunci baru" onPress={start} loading={busy} /> : null}
                </>
              )}
              <Pressable onPress={stop} style={s.stop}>
                <Text style={s.stopText}>Akhiri live</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable onPress={() => router.push('/live')} style={s.link}>
            <Text style={s.linkText}>Lihat daftar live</Text>
          </Pressable>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 12 },
  h: { fontSize: 16, fontWeight: '800', color: colors.text },
  input: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, fontSize: 15, color: colors.text, backgroundColor: colors.bg },
  hint: { color: colors.textSub, fontSize: 12.5, lineHeight: 18 },
  step: { color: colors.text, fontSize: 14, lineHeight: 20 },
  status: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 8, alignItems: 'flex-start' },
  badge: { paddingHorizontal: 12, height: 26, borderRadius: 13, justifyContent: 'center' },
  badgeLive: { backgroundColor: '#EF4444' },
  badgeWait: { backgroundColor: '#8B5CF6' },
  badgeWarn: { backgroundColor: '#F59E0B' },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  statusTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  views: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewsText: { color: colors.textSub, fontWeight: '600' },
  copyBox: { backgroundColor: '#F6F1FA', borderRadius: radius.md, padding: 12, gap: 6 },
  copyLabel: { color: colors.textSub, fontSize: 12.5, fontWeight: '600' },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  copyValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 32, borderRadius: radius.pill, backgroundColor: '#EDE3FF' },
  copyBtnText: { color: colors.primaryDark, fontWeight: '800', fontSize: 12.5 },
  stop: { height: 46, borderRadius: radius.pill, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  stopText: { color: colors.danger, fontWeight: '800', fontSize: 15 },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: colors.primary, fontWeight: '700' },
});
