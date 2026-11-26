import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GiftIcon } from '@/components/GiftIcon';
import { MediaBubble } from '@/components/ChatMedia';
import { GiftSheet } from '@/components/GiftSheet';
import { SafetyMenu } from '@/components/SafetyMenu';
import { Avatar, Coin } from '@/components/ui';
import { Verified } from '@/components/Verified';
import { useAuth } from '@/context/auth';
import { useRealtime } from '@/context/realtime';
import { ApiError, api, errorMessage } from '@/lib/api';
import { compact, lastSeen, number } from '@/lib/format';
import { playGift, playWaUnlocked } from '@/lib/giftFx';
import { emitRealtime, onRealtime, onRealtimeConnect } from '@/lib/realtime';
import { colors, gradients, radius } from '@/lib/theme';
import type { Conversation, Host, Message, WhatsappStatus } from '@/lib/types';

const PAGE = 30;

const time = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function ChatRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = Number(id);
  const insets = useSafeAreaInsets();
  const { user, refreshMe } = useAuth();
  const { refreshUnread } = useRealtime();

  const [conv, setConv] = useState<Conversation | null>(null);
  const [host, setHost] = useState<Host | null>(null);
  const [messages, setMessages] = useState<Message[]>([]); // terbaru di depan (list terbalik)
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [wa, setWa] = useState<WhatsappStatus | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  const noMore = useRef(false);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myId = user?.id;
  const peerName = useRef<string | undefined>(undefined);
  peerName.current = conv?.peer?.displayName;
  const isUser = conv?.role === 'user';
  const isUserRef = useRef(isUser);
  isUserRef.current = isUser;
  const price = isUser ? host?.chatPrice ?? 0 : 0;

  // ---------- Memuat data ----------
  const markRead = useCallback(() => {
    api
      .post(`/api/conversations/${convId}/read`)
      .then(refreshUnread)
      .catch(() => {});
  }, [convId, refreshUnread]);

  const loadWa = useCallback(() => {
    api.get<WhatsappStatus>(`/api/conversations/${convId}/whatsapp`).then(setWa).catch(() => {});
  }, [convId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, msgs] = await Promise.all([
          api.get<Conversation>(`/api/conversations/${convId}`),
          api.get<Message[]>(`/api/conversations/${convId}/messages?limit=${PAGE}`),
        ]);
        if (!alive) return;
        setConv(c);
        setMessages([...msgs].reverse());
        noMore.current = msgs.length < PAGE;
        if (c.role === 'user' && c.peer) {
          api.get<Host>(`/api/hosts/${c.peer.id}`).then((h) => alive && setHost(h)).catch(() => {});
        }
        loadWa();
        markRead();
      } catch (e) {
        Alert.alert('Gagal membuka chat', errorMessage(e));
        router.back();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [convId, loadWa, markRead]);

  // Perbarui status online saat kembali ke layar ini
  useFocusEffect(
    useCallback(() => {
      api.get<Conversation>(`/api/conversations/${convId}`).then(setConv).catch(() => {});
    }, [convId])
  );

  const loadOlder = async () => {
    if (loadingMore || noMore.current || !messages.length) return;
    setLoadingMore(true);
    try {
      const oldest = messages[messages.length - 1].id;
      const older = await api.get<Message[]>(`/api/conversations/${convId}/messages?limit=${PAGE}&before=${oldest}`);
      noMore.current = older.length < PAGE;
      setMessages((cur) => [...cur, ...[...older].reverse()]);
    } catch {
      // coba lagi saat scroll berikutnya
    } finally {
      setLoadingMore(false);
    }
  };

  // ---------- Realtime ----------
  const addMessage = useCallback((m: Message) => {
    setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [m, ...cur]));
  }, []);

  // Muat ulang pesan terbaru dan gabungkan (dipakai saat socket tersambung ulang)
  const syncLatest = useCallback(async () => {
    try {
      const [c, msgs] = await Promise.all([
        api.get<Conversation>(`/api/conversations/${convId}`),
        api.get<Message[]>(`/api/conversations/${convId}/messages?limit=${PAGE}`),
      ]);
      setConv(c);
      setMessages((cur) => {
        const byId = new Map(cur.map((m) => [m.id, m]));
        for (const m of msgs) byId.set(m.id, { ...byId.get(m.id), ...m });
        return [...byId.values()].sort((a, b) => b.id - a.id);
      });
      markRead();
    } catch {
      // coba lagi pada sambungan berikutnya
    }
  }, [convId, markRead]);

  const setStatus = useCallback((ids: number[], status: Message['paymentStatus']) => {
    const set = new Set(ids);
    setMessages((cur) => cur.map((m) => (set.has(m.id) ? { ...m, paymentStatus: status } : m)));
  }, []);

  useEffect(() => {
    const offs = [
      onRealtimeConnect(() => {
        syncLatest();
      }),
      onRealtime<{ conversationId: number; message: Message; conversation: Conversation }>('message:new', (e) => {
        if (e.conversationId !== convId) return;
        addMessage(e.message);
        if (e.conversation) setConv(e.conversation);
        if (e.message.senderId !== myId) {
          setTyping(false);
          markRead();
        }
        if (e.message.type === 'gift' && e.message.gift) {
          const g = e.message.gift;
          playGift({
            messageId: e.message.id,
            giftId: g.id,
            name: g.name,
            icon: g.icon,
            imageUrl: g.imageUrl,
            videoUrl: g.animationUrl,
            soundUrl: g.soundUrl,
            // Host melihat diamond yang ia terima, bukan harga gift
            hostIncome: isUserRef.current ? null : e.message.hostIncome,
            blend: g.animationBlend,
            count: g.count,
            price: g.price,
            category: g.category,
            total: e.message.price,
            from: e.message.senderId !== myId ? peerName.current : undefined,
          });
        }
        if (e.message.type !== 'text') loadWa();
      }),
      onRealtime<{ conversationId: number; messageIds: number[] }>('chat:settled', (e) => {
        if (e.conversationId === convId) setStatus(e.messageIds, 'paid');
      }),
      onRealtime<{ conversationId: number; messageIds: number[]; amount: number }>('chat:refunded', (e) => {
        if (e.conversationId === convId) setStatus(e.messageIds, 'refunded');
      }),
      onRealtime<{ conversationId: number; userId: number }>('typing', (e) => {
        if (e.conversationId !== convId || e.userId === myId) return;
        setTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(false), 3500);
      }),
      onRealtime<{ conversationId: number }>('wa:unlocked', (e) => {
        if (e.conversationId !== convId) return;
        api
          .get<WhatsappStatus>(`/api/conversations/${convId}/whatsapp`)
          .then((w) => {
            setWa(w);
            playWaUnlocked(convId, peerName.current, w.link);
          })
          .catch(() => {});
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [convId, myId, addMessage, setStatus, markRead, loadWa, syncLatest]);

  // ---------- Kirim ----------
  const onChangeText = (v: string) => {
    setText(v);
    if (Date.now() - lastTypingSent.current > 2500 && v.trim()) {
      lastTypingSent.current = Date.now();
      emitRealtime('typing', { conversationId: convId });
    }
  };

  // Kirim foto/video (khusus VIP)
  const pickMedia = async () => {
    if ((user?.membership?.vip ?? 0) < 1) {
      Alert.alert('Khusus VIP', 'Kirim foto dan video tersedia untuk pengguna VIP. Top up untuk jadi VIP.', [
        { text: 'Nanti', style: 'cancel' },
        { text: 'Lihat VIP', onPress: () => router.push('/vip') },
      ]);
      return;
    }
    if (sending) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.7, videoMaxDuration: 60 });
    if (res.canceled) return;
    const a = res.assets[0];
    const isVideo = a.type === 'video';
    if (a.fileSize && a.fileSize > 15 * 1024 * 1024) {
      Alert.alert('File terlalu besar', 'Ukuran maksimal 15 MB. Pilih file yang lebih kecil.');
      return;
    }
    setSending(true);
    try {
      const mime = a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
      const form = new FormData();
      form.append('file', { uri: a.uri, name: `${isVideo ? 'video' : 'foto'}.${mime.split('/')[1] ?? 'jpg'}`, type: mime } as unknown as Blob);
      const r = await api.post<{ message: Message }>(`/api/conversations/${convId}/media`, form);
      addMessage(r.message);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VIP_REQUIRED') router.push('/vip');
      else Alert.alert('Gagal mengirim', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await api.post<{ message: Message; settled?: { messageIds: number[] } | null }>(
        `/api/conversations/${convId}/messages`,
        { body }
      );
      addMessage(r.message);
      if (isUser) refreshMe(); // kartu gratis & saldo
      // Host membalas: pesan user yang ditahan sekarang sudah dibayar
      if (r.settled?.messageIds?.length) setStatus(r.settled.messageIds, 'paid');
      setText('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_COINS') {
        Alert.alert('Koin tidak cukup', `Kirim pesan butuh ${number(price)} koin.`, [
          { text: 'Nanti', style: 'cancel' },
          { text: 'Top up', onPress: () => router.push('/topup') },
        ]);
      } else if (e instanceof ApiError && (e.code === 'CONTACT_BLOCKED' || e.code === 'WAIT_FOR_REPLY' || e.code === 'BLOCKED')) {
        Alert.alert(e.code === 'WAIT_FOR_REPLY' ? 'Tunggu balasan dulu' : 'Pesan tidak terkirim', e.message);
      } else {
        Alert.alert('Gagal mengirim', errorMessage(e));
      }
    } finally {
      setSending(false);
    }
  };

  const openGift = () => setGiftOpen(true);
  const getConvId = useCallback(async () => convId, [convId]);
  const onGiftSent = useCallback(
    (r: { message: Message; systemMessage?: Message | null }) => {
      addMessage(r.message);
      if (r.systemMessage) addMessage(r.systemMessage);
      loadWa();
    },
    [addMessage, loadWa]
  );

  // Host: koin yang menunggu dibalas
  const heldForHost = useMemo(
    () => (!isUser ? messages.filter((m) => m.paymentStatus === 'held').reduce((s, m) => s + m.price, 0) : 0),
    [messages, isUser]
  );

  if (loading || !conv) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const peer = conv.peer;
  const status = typing ? 'sedang mengetik…' : lastSeen(peer?.lastSeenAt, peer?.online);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior="padding">
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable hitSlop={10} onPress={() => router.back()} style={s.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Pressable
          style={s.peer}
          disabled={!isUser || !peer}
          onPress={() => peer && router.push({ pathname: '/host/[id]', params: { id: String(peer.id) } })}
        >
          <View>
            <Avatar uri={peer?.avatarUrl} name={peer?.displayName} size={40} />
            {peer?.online ? <View style={s.onlineDot} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={s.peerName} numberOfLines={1}>
                {peer?.displayName ?? 'Chat'}
              </Text>
              {peer?.verified ? <Verified size={15} /> : null}
            </View>
            <Text style={[s.peerStatus, typing && { color: colors.primary }]} numberOfLines={1}>
              {status}
            </Text>
          </View>
        </Pressable>
        {peer ? <SafetyMenu userId={peer.id} name={peer.displayName} conversationId={convId} onBlocked={() => router.back()} /> : null}
      </View>

      {/* Bar WhatsApp (user) */}
      {isUser && wa?.enabled ? <WaBar wa={wa} onGift={openGift} /> : null}

      {/* Host: pengingat penghasilan */}
      {!isUser && heldForHost > 0 ? (
        <View style={s.hostHint}>
          <Ionicons name="diamond" size={16} color={colors.primary} />
          <Text style={s.hostHintText}>Balas sekarang untuk menerima bagian dari {number(heldForHost)} koin</Text>
        </View>
      ) : null}
      {!isUser && heldForHost === 0 ? (
        <View style={s.hostHint}>
          <Ionicons name="gift-outline" size={16} color={colors.primary} />
          <Text style={s.hostHintText}>Pesanmu gratis. Koin masuk saat kamu membalas pesan dari pengguna.</Text>
        </View>
      ) : null}

      {/* Pesan */}
      <FlatList
        style={{ flex: 1 }}
        data={messages}
        inverted
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.3}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} /> : null}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>
              {isUser ? `Sapa ${peer?.displayName ?? 'host'} sekarang 👋` : 'Belum ada pesan'}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const prev = messages[index + 1];
          const showDate = !prev || new Date(prev.createdAt).toDateString() !== new Date(item.createdAt).toDateString();
          return (
            <View>
              {showDate ? <DateLabel iso={item.createdAt} /> : null}
              <Bubble message={item} mine={item.senderId === myId} showPayment={isUser} hostView={!isUser} />
            </View>
          );
        }}
      />

      {/* Info tarif (user) */}
      {isUser && price > 0 ? (
        (user?.membership?.freeCardsLeft ?? 0) > 0 ? (
          <View style={s.priceRow}>
            <Ionicons name="ticket-outline" size={14} color="#D9801A" />
            <Text style={s.priceText}>
              Kartu pesan gratis VIP: sisa {user?.membership?.freeCardsLeft} hari ini · pesan tidak memotong koin
            </Text>
            <Text style={s.balance}>Saldo {compact(user?.coins ?? 0)}</Text>
          </View>
        ) : (
          <View style={s.priceRow}>
            <Coin size={13} />
            <Text style={s.priceText}>
              {number(price)} koin/pesan · dikembalikan jika tidak dibalas dalam 24 jam
            </Text>
            <Text style={s.balance}>Saldo {compact(user?.coins ?? 0)}</Text>
          </View>
        )
      ) : null}

      {/* Kolom tulis */}
      <View style={[s.composer, { paddingBottom: insets.bottom + 8 }]}>
        {isUser ? (
          <Pressable onPress={openGift} style={s.giftBtn} hitSlop={6}>
            <Ionicons name="gift" size={22} color="#F59E0B" />
          </Pressable>
        ) : null}
        {isUser ? (
          <Pressable onPress={pickMedia} style={s.giftBtn} hitSlop={6}>
            <Ionicons name="image" size={22} color={(user?.membership?.vip ?? 0) > 0 ? colors.primary : colors.textDim} />
          </Pressable>
        ) : null}
        <TextInput
          value={text}
          onChangeText={onChangeText}
          placeholder="Tulis pesan…"
          placeholderTextColor={colors.textDim}
          multiline
          maxLength={1000}
          style={s.input}
          selectionColor={colors.primary}
        />
        <Pressable onPress={send} disabled={!text.trim() || sending}>
          <LinearGradient
            colors={gradients.brand}
            style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
          </LinearGradient>
        </Pressable>
      </View>

      {isUser ? (
        <GiftSheet
          visible={giftOpen}
          onClose={() => setGiftOpen(false)}
          getConversationId={getConvId}
          hostName={peer?.displayName}
          onSent={onGiftSent}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------

function WaBar({ wa, onGift }: { wa: WhatsappStatus; onGift: () => void }) {
  if (wa.unlocked && wa.link) {
    return (
      <View style={[s.wa, { backgroundColor: '#ECFDF5', borderColor: '#BBF7D0' }]}>
        <Ionicons name="logo-whatsapp" size={22} color="#16A34A" />
        <Text style={[s.waText, { color: '#14532D' }]}>WhatsApp sudah terbuka 🎉</Text>
        <Pressable onPress={() => Linking.openURL(wa.link!).catch(() => Alert.alert('WhatsApp', wa.number ?? ''))} style={s.waBtn}>
          <Text style={s.waBtnText}>Chat WA</Text>
        </Pressable>
      </View>
    );
  }
  const threshold = wa.threshold ?? 0;
  const progress = threshold > 0 ? Math.min(1, wa.giftTotal / threshold) : 0;
  return (
    <Pressable onPress={onGift} style={s.wa}>
      <Ionicons name="lock-closed" size={18} color="#16A34A" />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.waText}>
          Buka WhatsApp · {compact(wa.giftTotal)}/{compact(threshold)} koin gift
        </Text>
        <View style={s.track}>
          <View style={[s.fill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
      <Ionicons name="gift" size={20} color="#F59E0B" />
    </Pressable>
  );
}

function DateLabel({ iso }: { iso: string }) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const label =
    d.toDateString() === today.toDateString()
      ? 'Hari ini'
      : d.toDateString() === yesterday.toDateString()
        ? 'Kemarin'
        : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  return <Text style={s.date}>{label}</Text>;
}

function Bubble({ message: m, mine, showPayment, hostView }: { message: Message; mine: boolean; showPayment: boolean; hostView: boolean }) {
  if (m.type === 'system') {
    return (
      <View style={s.system}>
        <Text style={s.systemText}>{m.body}</Text>
      </View>
    );
  }

  const payment =
    mine && showPayment && m.type === 'text' && (m.price > 0 || m.freeCard)
      ? {
          held: { icon: 'time-outline' as const, text: `${number(m.price)} koin ditahan`, color: colors.textDim },
          paid: { icon: 'checkmark-done' as const, text: 'Dibalas', color: colors.primary },
          refunded: { icon: 'arrow-undo' as const, text: 'Tidak dibalas · koin dikembalikan', color: colors.online },
          free: m.freeCard ? { icon: 'ticket-outline' as const, text: 'Kartu gratis VIP', color: '#D9801A' } : null,
        }[m.paymentStatus]
      : null;

  if (m.type === 'gift') {
    return (
      <View style={[s.row, mine ? s.rowMine : s.rowTheirs]}>
        <LinearGradient colors={['#FFF1DB', '#FFE4F1']} style={s.giftCard}>
          <GiftIcon icon={m.gift?.icon} imageUrl={m.gift?.imageUrl} size={42} />
          <View>
            <Text style={s.giftName}>
              {m.gift?.name ?? 'Gift'} x{m.gift?.count ?? 1}
            </Text>
            {hostView ? (
              m.hostIncome != null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 12 }}>💎</Text>
                  <Text style={s.giftPrice}>{number(m.hostIncome)}</Text>
                </View>
              ) : null
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Coin size={12} />
                <Text style={s.giftPrice}>{number(m.price)}</Text>
              </View>
            )}
          </View>
        </LinearGradient>
        <Text style={[s.meta, mine && { textAlign: 'right' }]}>{time(m.createdAt)}</Text>
      </View>
    );
  }

  if ((m.type === 'image' || m.type === 'video') && m.mediaUrl) {
    return (
      <View style={[s.row, mine ? s.rowMine : s.rowTheirs]}>
        <MediaBubble type={m.type} url={m.mediaUrl} />
        <Text style={[s.meta, mine && { textAlign: 'right' }]}>{time(m.createdAt)}</Text>
      </View>
    );
  }

  return (
    <View style={[s.row, mine ? s.rowMine : s.rowTheirs]}>
      {mine ? (
        <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.bubble, s.bubbleMine]}>
          <Text style={[s.bubbleText, { color: '#fff' }]}>{m.body}</Text>
        </LinearGradient>
      ) : (
        <View style={[s.bubble, s.bubbleTheirs]}>
          <Text style={s.bubbleText}>{m.body}</Text>
        </View>
      )}
      <View style={[s.metaRow, mine && { justifyContent: 'flex-end' }]}>
        {payment ? (
          <>
            <Ionicons name={payment.icon} size={12} color={payment.color} />
            <Text style={[s.meta, { color: payment.color }]}>{payment.text} · </Text>
          </>
        ) : null}
        <Text style={s.meta}>{time(m.createdAt)}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingBottom: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  peer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  peerName: { fontSize: 16, fontWeight: '800', color: colors.text, flexShrink: 1 },
  peerStatus: { fontSize: 12, color: colors.textSub },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.online,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  wa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: 10,
    marginBottom: 0,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  waText: { flex: 1, color: '#166534', fontWeight: '700', fontSize: 13 },
  waBtn: { backgroundColor: '#16A34A', paddingHorizontal: 14, height: 32, borderRadius: radius.pill, justifyContent: 'center' },
  waBtnText: { color: '#fff', fontWeight: '800' },
  track: { height: 6, borderRadius: 3, backgroundColor: '#DCFCE7', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: '#22C55E' },
  hostHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 10,
    marginBottom: 0,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: '#F3E8FF',
  },
  hostHintText: { flex: 1, color: colors.primaryDark, fontWeight: '700', fontSize: 13 },
  empty: { alignItems: 'center', paddingVertical: 40, transform: [{ scaleY: -1 }] },
  emptyText: { color: colors.textSub, fontSize: 15, fontWeight: '600' },
  date: { alignSelf: 'center', color: colors.textDim, fontSize: 12, fontWeight: '700', marginVertical: 10 },
  system: { alignSelf: 'center', backgroundColor: '#ECFDF5', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, marginVertical: 8 },
  systemText: { color: '#15803D', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  row: { marginVertical: 3, maxWidth: '80%' },
  rowMine: { alignSelf: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  bubbleMine: { borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.border },
  bubbleText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3, paddingHorizontal: 4 },
  meta: { color: colors.textDim, fontSize: 11 },
  giftCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  giftName: { color: colors.text, fontWeight: '800', fontSize: 15 },
  giftPrice: { color: colors.textSub, fontWeight: '700', fontSize: 12 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: colors.surfaceAlt },
  priceText: { flex: 1, color: colors.textSub, fontSize: 11 },
  balance: { color: colors.text, fontWeight: '800', fontSize: 11 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  giftBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFF1DB', alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 21,
    backgroundColor: colors.bg,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    color: colors.text,
    fontSize: 15,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
