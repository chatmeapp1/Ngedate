import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { RawText, Text, TextInput } from '@/components/I18nText';
import { TranslateLink } from '@/components/TranslateLink';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LevelBadge } from '@/components/Badges';
import { Avatar, Loading, ScreenHeader } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { useAuth } from '@/context/auth';
import { api, errorMessage } from '@/lib/api';
import { compact } from '@/lib/format';
import { colors, gradients } from '@/lib/theme';
import type { Moment, MomentComment } from '@/lib/types';

function stamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function MomentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [m, setM] = useState<Moment | null>(null);
  const [comments, setComments] = useState<MomentComment[]>([]);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [viewer, setViewer] = useState(false);

  const loadComments = useCallback(() => api.get<MomentComment[]>(`/api/moments/${id}/comments`).then(setComments).catch(() => {}), [id]);

  useEffect(() => {
    api
      .get<Moment>(`/api/moments/${id}`)
      .then((r) => {
        setM(r);
        loadComments();
      })
      .catch(() => setMissing(true));
  }, [id, loadComments]);

  const like = async () => {
    if (!m) return;
    setM({ ...m, liked: !m.liked, likes: m.likes + (m.liked ? -1 : 1) }); // langsung terlihat
    try {
      const r = await api.post<{ liked: boolean; likes: number }>(`/api/moments/${m.id}/like`);
      setM((cur) => (cur ? { ...cur, liked: r.liked, likes: r.likes } : cur));
    } catch {
      setM((cur) => (cur ? { ...cur, liked: m.liked, likes: m.likes } : cur));
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending || !m) return;
    setSending(true);
    try {
      await api.post(`/api/moments/${m.id}/comments`, { body });
      setText('');
      setM((cur) => (cur ? { ...cur, comments: cur.comments + 1 } : cur));
      await loadComments();
    } catch (e) {
      Alert.alert('Komentar gagal', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const remove = () =>
    Alert.alert('Hapus momen?', 'Momen ini akan dihapus permanen.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          await api.del(`/api/moments/${id}`).catch(() => {});
          router.back();
        },
      },
    ]);

  if (missing) return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Momen" />
      <Text style={{ textAlign: 'center', color: colors.textSub, marginTop: 40 }}>Momen tidak ditemukan</Text>
    </View>
  );
  if (!m) return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Momen" />
      <Loading />
    </View>
  );

  const mine = m.host.id === user?.id;
  const imgW = Math.min(width - 32, 360);

  const header = (
    <View>
      <LinearGradient colors={gradients.header} style={s.top}>
        <Pressable onPress={() => router.push({ pathname: '/host/[id]', params: { id: String(m.host.id) } })} style={s.hostRow}>
          <Avatar uri={m.host.avatarUrl} name={m.host.displayName} size={48} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={s.hostName} numberOfLines={1}>{m.host.displayName}</Text>
              {m.host.verified ? <Verified size={15} /> : null}
            </View>
            <Text style={s.time}>{stamp(m.createdAt)}</Text>
          </View>
          <View style={s.views}>
            <Ionicons name="stats-chart" size={15} color={colors.pink} />
            <Text style={s.viewsText}>{compact(m.views)}</Text>
          </View>
        </Pressable>
      </LinearGradient>

      {m.status !== 'approved' ? (
        <View style={[s.notice, m.status === 'rejected' && { backgroundColor: '#FEE2E2' }]}>
          <Text style={[s.noticeText, m.status === 'rejected' && { color: '#B91C1C' }]}>
            {m.status === 'pending' ? 'Menunggu persetujuan admin. Foto baru tampil ke pengguna setelah disetujui.' : `Ditolak admin${m.rejectReason ? `: ${m.rejectReason}` : ''}`}
          </Text>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 16, gap: 12, paddingTop: 6 }}>
        {m.body ? (
          <View>
            <RawText style={s.body}>{m.body}</RawText>
            <TranslateLink text={m.body} />
          </View>
        ) : null}
        {m.imageUrl ? (
          <Pressable onPress={() => setViewer(true)} style={{ alignSelf: 'center' }}>
            <Image source={{ uri: m.imageUrl }} style={{ width: imgW, height: imgW * 1.3, borderRadius: 16, backgroundColor: colors.surfaceAlt }} contentFit="cover" transition={150} />
          </Pressable>
        ) : null}

        <View style={s.stats}>
          <Pressable onPress={like} hitSlop={8} style={s.stat}>
            <Ionicons name={m.liked ? 'heart' : 'heart-outline'} size={22} color={m.liked ? colors.pink : colors.textSub} />
            <Text style={[s.statText, m.liked && { color: colors.pink }]}>{compact(m.likes)}</Text>
          </Pressable>
          <View style={s.stat}>
            <Ionicons name="chatbox-ellipses-outline" size={21} color={colors.textSub} />
            <Text style={s.statText}>{compact(m.comments)}</Text>
          </View>
          <View style={s.stat}>
            <Ionicons name="eye-outline" size={22} color={colors.textSub} />
            <Text style={s.statText}>{compact(m.views)}</Text>
          </View>
        </View>
      </View>
      <Text style={s.cHead}>Komentar</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Momen" right={mine ? <Pressable onPress={remove} hitSlop={10}><Ionicons name="trash-outline" size={21} color={colors.textSub} /></Pressable> : undefined} />
      <FlatList
        data={comments}
        keyExtractor={(c) => String(c.id)}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={s.noComment}>Belum ada komentar</Text>}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={s.comment}>
            <Avatar uri={item.user.avatarUrl} name={item.user.displayName} size={38} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={s.cName} numberOfLines={1}>{item.user.displayName}</Text>
                {item.user.level != null ? <LevelBadge level={item.user.level} size={18} /> : null}
                {item.user.verified ? <Verified size={13} /> : null}
              </View>
              <Text style={s.cTime}>{stamp(item.createdAt)}</Text>
              <RawText style={s.cBody}>{item.body}</RawText>
              <TranslateLink text={item.body} />
            </View>
          </View>
        )}
      />
      <View style={[s.inputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput value={text} onChangeText={setText} placeholder="Tulis komentar…" placeholderTextColor={colors.textDim} maxLength={300} style={s.input} />
        <Pressable onPress={send} disabled={!text.trim() || sending} style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}>
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={17} color="#fff" />}
        </Pressable>
      </View>

      <Modal visible={viewer} transparent animationType="fade" onRequestClose={() => setViewer(false)}>
        <Pressable style={s.viewer} onPress={() => setViewer(false)}>
          {m.imageUrl ? <Image source={{ uri: m.imageUrl }} style={{ width: '100%', height: '100%' }} contentFit="contain" /> : null}
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  notice: { marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: '#FEF3C7' },
  noticeText: { color: '#92400E', fontSize: 12.5, fontWeight: '500' },
  top: { paddingHorizontal: 16, paddingVertical: 10 },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hostName: { flexShrink: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  time: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  views: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  viewsText: { color: colors.pink, fontSize: 15, fontWeight: '700' },
  body: { fontSize: 16, color: colors.text, lineHeight: 23 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6, paddingVertical: 8 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statText: { color: colors.textSub, fontSize: 15, fontWeight: '500' },
  cHead: { fontSize: 15, fontWeight: '600', color: colors.text, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  noComment: { textAlign: 'center', color: colors.textDim, paddingVertical: 24 },
  comment: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  cName: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  cTime: { color: colors.textDim, fontSize: 11 },
  cBody: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 2 },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, paddingHorizontal: 14, fontSize: 14, color: colors.text },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: '#000' },
});
