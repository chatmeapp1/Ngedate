import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafetyMenu } from '@/components/SafetyMenu';
import { Avatar } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api, errorMessage, getServerUrl } from '@/lib/api';
import { emitRealtime, onRealtime, onRealtimeConnect } from '@/lib/realtime';
import type { LiveChatMessage, LiveDetail } from '@/lib/types';

const ENDED_TEXT: Record<string, string> = {
  host: 'Live telah berakhir',
  admin: 'Live dihentikan oleh admin',
  dropped: 'Siaran terputus',
  timeout: 'Live telah berakhir',
};

/** Pemutar siaran: video LL-HLS di belakang, obrolan live di depan. */
export default function LiveRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const liveId = Number(id);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [d, setD] = useState<LiveDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const [viewers, setViewers] = useState(0);
  const [chat, setChat] = useState<LiveChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [kbShown, setKbShown] = useState(false);
  const listRef = useRef<FlatList<LiveChatMessage>>(null);
  const gotCount = useRef(false); // hitungan dari event socket lebih baru daripada hasil load()

  const url = d?.playbackUrl ? `${getServerUrl() ?? ''}${d.playbackUrl}` : null;
  const player = useVideoPlayer(url ? { uri: url } : null, (p) => {
    p.loop = false;
    p.play();
  });

  const load = useCallback(async () => {
    try {
      const r = await api.get<LiveDetail>(`/api/live/${liveId}`);
      setD(r);
      setViewers((v) => (gotCount.current ? v : r.viewers));
      setChat(r.chat);
      if (r.status === 'ended') setEnded(ENDED_TEXT[r.endedReason ?? 'host'] ?? ENDED_TEXT.host);
    } catch {
      setFailed(true);
    }
  }, [liveId]);

  useEffect(() => {
    load();
  }, [load]);

  // Masuk room siaran (juga setiap menyambung ulang), keluar saat layar ditutup
  useEffect(() => {
    if (!Number.isFinite(liveId)) return;
    const join = () => emitRealtime('live:join', { id: liveId });
    join();
    const off = [
      onRealtimeConnect(() => {
        join();
        load();
      }),
      onRealtime<{ id: number; count: number }>('live:viewers', (e) => {
        if (e.id !== liveId) return;
        gotCount.current = true;
        setViewers(e.count);
      }),
      onRealtime<{ id: number; message: LiveChatMessage }>('live:chat', (e) => {
        if (e.id !== liveId) return;
        setChat((cur) => [...cur.slice(-79), e.message]);
      }),
      onRealtime<{ id: number; reason: string }>('live:ended', (e) => e.id === liveId && setEnded(ENDED_TEXT[e.reason] ?? ENDED_TEXT.host)),
    ];
    return () => {
      emitRealtime('live:leave', { id: liveId });
      off.forEach((f) => f());
    };
  }, [liveId, load]);

  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKbShown(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKbShown(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  useEffect(() => {
    if (chat.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [chat.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.post(`/api/live/${liveId}/chat`, { body });
      setText('');
    } catch (e) {
      Alert.alert('Pesan tidak terkirim', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  if (failed) {
    return (
      <View style={[s.center, { backgroundColor: '#000' }]}>
        <Text style={s.endText}>Siaran tidak ditemukan</Text>
        <Pressable onPress={() => router.back()} style={s.endBtn}>
          <Text style={s.endBtnText}>Kembali</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior="padding" enabled={kbShown}>
      {url && !ended ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} /> : null}
      {!d ? <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} /> : null}

      {/* Atas: host, jumlah penonton, tutup */}
      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <View style={s.hostPill}>
          <Avatar uri={d?.host.avatarUrl} name={d?.host.displayName} size={34} />
          <View style={{ maxWidth: 130 }}>
            <Text style={s.hostName} numberOfLines={1}>
              {d?.host.displayName ?? ''}
            </Text>
            <Text style={s.hostSub} numberOfLines={1}>
              {d?.title || 'Live'}
            </Text>
          </View>
        </View>
        <View style={s.views}>
          <Ionicons name="eye" size={13} color="#fff" />
          <Text style={s.viewsText}>{viewers}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {d && user && d.host.id !== user.id ? <SafetyMenu userId={d.host.id} name={d.host.displayName} light onBlocked={() => router.back()} /> : null}
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.close}>
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
      </View>

      {ended ? (
        <View style={[StyleSheet.absoluteFill, s.center, { backgroundColor: 'rgba(0,0,0,0.78)' }]}>
          <Ionicons name="videocam-off" size={44} color="#fff" />
          <Text style={s.endText}>{ended}</Text>
          <Pressable onPress={() => router.back()} style={s.endBtn}>
            <Text style={s.endBtnText}>Kembali</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Bawah: obrolan live */}
      <View style={[s.bottom, { paddingBottom: kbShown ? 8 : insets.bottom + 8 }]} pointerEvents="box-none">
        <FlatList
          ref={listRef}
          data={chat}
          keyExtractor={(m) => m.id}
          style={s.chatList}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={s.msg}>
              <Text style={s.msgText}>
                <Text style={[s.msgName, item.user.isHost && { color: '#FDE047' }]}>
                  {item.user.isHost ? '★ ' : ''}
                  {item.user.displayName}
                  {'  '}
                </Text>
                {item.body}
              </Text>
            </View>
          )}
        />
        {!ended ? (
          <View style={s.composer}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Ketik komentar…"
              placeholderTextColor="rgba(255,255,255,0.6)"
              style={s.input}
              maxLength={200}
              returnKeyType="send"
              onSubmitEditing={send}
              blurOnSubmit={false}
            />
            <Pressable onPress={send} disabled={!text.trim() || sending} style={[s.sendBtn, !text.trim() && { opacity: 0.45 }]}>
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  hostPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 24, paddingRight: 14, padding: 4 },
  hostName: { color: '#fff', fontWeight: '800', fontSize: 13 },
  hostSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
  views: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 10, height: 28, borderRadius: 14 },
  viewsText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12 },
  chatList: { maxHeight: 200, marginBottom: 8 },
  msg: { alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 4, maxWidth: '85%' },
  msgText: { color: '#fff', fontSize: 13.5, lineHeight: 19 },
  msgName: { color: '#C4B5FD', fontWeight: '800' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.45)', color: '#fff', paddingHorizontal: 16, fontSize: 14 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#8B5CF6', alignItems: 'center', justifyContent: 'center' },
  endText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  endBtn: { backgroundColor: '#8B5CF6', borderRadius: 22, paddingHorizontal: 26, height: 42, alignItems: 'center', justifyContent: 'center' },
  endBtnText: { color: '#fff', fontWeight: '800' },
});
