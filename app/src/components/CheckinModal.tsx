import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/components/I18nText';
import { Coin } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api, errorMessage } from '@/lib/api';
import type { CheckinReward, CheckinStatus } from '@/lib/types';

const FRAME_IMG = [require('../../assets/vip/ci1.png'), require('../../assets/vip/ci2.png')];

/** Isi satu kotak hadiah: koin, pesan gratis, atau bingkai avatar. */
function RewardFace({ r, big }: { r: CheckinReward; big?: boolean }) {
  if (r.type === 'coins') {
    return (
      <>
        {big ? <Text style={s.bigGift}>🎁</Text> : null}
        <View style={s.amountRow}>
          <Coin size={big ? 20 : 16} />
          <Text style={[s.amount, big && { fontSize: 20 }]}>+{r.amount}</Text>
        </View>
      </>
    );
  }
  if (r.type === 'cards') {
    return (
      <>
        <View style={s.amountRow}>
          <Ionicons name="chatbubble-ellipses" size={big ? 26 : 18} color="#FDE68A" />
          <Text style={s.amount}>{r.amount}x</Text>
        </View>
        <Text style={s.sub} numberOfLines={1}>
          pesan gratis
        </Text>
      </>
    );
  }
  return (
    <>
      <Image source={FRAME_IMG[Math.min(r.frame, FRAME_IMG.length) - 1]} style={{ width: big ? 70 : 38, height: big ? 70 : 38 }} contentFit="contain" />
      <Text style={s.sub} numberOfLines={1}>
        {r.days} hari
      </Text>
    </>
  );
}

const rewardText = (r: CheckinReward) => (r.type === 'coins' ? `+${r.amount} koin` : r.type === 'cards' ? `${r.amount} pesan gratis` : `bingkai avatar ${r.days} hari`);

// Posisi kotak pada gambar bingkai (900 x 941), dipakai sebagai pecahan
const W = 900;
const H = 941;
const COLS: [number, number][] = [
  [62, 230],
  [249, 418],
  [436, 604],
];
const ROWS: [number, number][] = [
  [295, 495],
  [513, 713],
];
const BIG = { x: [626, 839], y: [295, 713] };
const BTN = { x: [58, 843], y: [750, 868] };

const rect = (x: [number, number], y: [number, number]) => ({
  position: 'absolute' as const,
  left: `${(x[0] / W) * 100}%` as `${number}%`,
  width: `${((x[1] - x[0]) / W) * 100}%` as `${number}%`,
  top: `${(y[0] / H) * 100}%` as `${number}%`,
  height: `${((y[1] - y[0]) / H) * 100}%` as `${number}%`,
});

/** Pop-up check-in harian (hari 1-7) untuk pengguna. Muncul saat masuk aplikasi jika hari ini belum diklaim. */
let manualOpen: (() => void) | null = null;
/** Buka pop-up check-in harian dari mana saja (mis. halaman Ransel). */
export function openCheckin() {
  manualOpen?.();
}

export function CheckinModal() {
  const { user, refreshMe } = useAuth();
  const { width } = useWindowDimensions();
  const [st, setSt] = useState<CheckinStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gained, setGained] = useState<CheckinReward | null>(null);
  const shownFor = useRef<string | null>(null);
  const eligible = user?.role === 'user' && !!user.profileCompleted;
  const userId = user?.id;

  const check = useCallback(async () => {
    if (!eligible) return;
    const key = new Date().toDateString();
    if (shownFor.current === key) return;
    try {
      const r = await api.get<CheckinStatus>('/api/checkin');
      setSt(r);
      if (!r.claimedToday) {
        shownFor.current = key;
        setGained(null);
        setError(null);
        setOpen(true);
      }
    } catch {
      /* diam: coba lagi saat app dibuka berikutnya */
    }
  }, [eligible]);

  useEffect(() => {
    shownFor.current = null;
    if (eligible) check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, [eligible, userId, check]);

  useEffect(() => {
    if (!eligible) return;
    manualOpen = async () => {
      try {
        const r = await api.get<CheckinStatus>('/api/checkin');
        setSt(r);
        setGained(null);
        setError(null);
        setOpen(true);
      } catch {
        /* abaikan */
      }
    };
    return () => {
      manualOpen = null;
    };
  }, [eligible]);

  const claim = async () => {
    if (busy || !st || st.claimedToday) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<CheckinStatus & { coins: number }>('/api/checkin/claim');
      setSt(r);
      setGained(r.granted ?? null);
      refreshMe(); // saldo, pesan gratis, bingkai
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!eligible || !st) return null;
  const w = Math.min(width - 24, 420);
  const h = (w * H) / W;
  const claimedDays = st.claimedDays;

  const Cell = ({ day, big }: { day: number; big?: boolean }) => {
    const done = day <= claimedDays;
    const isCurrent = day === st.currentDay && !st.claimedToday;
    return (
      <View style={[s.cell, done && s.cellDone, isCurrent && s.cellNow]}>
        <View style={s.dayRow}>
          <Text style={s.dayText}>Hari {day}</Text>
          {done && !big ? <Ionicons name="checkmark-circle" size={14} color="#34D399" /> : null}
        </View>
        <RewardFace r={st.rewards[day - 1]} big={big} />
        {done && big ? (
          <View style={s.check}>
            <Ionicons name="checkmark-circle" size={34} color="#34D399" />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={s.backdrop}>
        <View style={{ width: w, height: h }}>
          <Image source={require('../../assets/checkin-frame.png')} style={StyleSheet.absoluteFill} contentFit="contain" />

          <Text style={[s.title, { top: `${(185 / H) * 100}%`, fontSize: w * 0.052 }]}>Check-in Harian</Text>

          {[0, 1].map((r) =>
            COLS.map((c, i) => (
              <View key={`${r}-${i}`} style={rect(c, ROWS[r])}>
                <Cell day={r * 3 + i + 1} />
              </View>
            ))
          )}
          <View style={rect(BIG.x as [number, number], BIG.y as [number, number])}>
            <Cell day={7} big />
          </View>

          <Pressable
            onPress={st.claimedToday ? () => setOpen(false) : claim}
            disabled={busy}
            style={[rect(BTN.x as [number, number], BTN.y as [number, number]), s.btn]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.btnText}>
                {st.claimedToday ? (gained ? `${rewardText(gained)} diterima · Tutup` : 'Sudah diklaim · Tutup') : `Klaim hari ke-${st.currentDay}`}
              </Text>
            )}
          </Pressable>

          <Pressable onPress={() => setOpen(false)} hitSlop={10} style={s.close}>
            <Ionicons name="close" size={18} color="#fff" />
          </Pressable>
        </View>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Text style={s.hint}>Check-in 7 hari berturut-turut. Lewat satu hari, hitungan mulai dari hari 1 lagi.</Text>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,5,25,0.72)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  title: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#fff', fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 4 },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 16, borderWidth: 1.5, borderColor: 'transparent' },
  cellDone: { backgroundColor: 'rgba(52,211,153,0.12)' },
  cellNow: { borderColor: '#FACC15', backgroundColor: 'rgba(250,204,21,0.14)' },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dayText: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },
  bigGift: { fontSize: 44 },
  sub: { color: 'rgba(255,255,255,0.88)', fontSize: 10, fontWeight: '600', textAlign: 'center' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  amount: { color: '#fff', fontSize: 15, fontWeight: '700' },
  check: { position: 'absolute', right: 6, bottom: 6 },
  btn: { alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 3 },
  close: { position: 'absolute', top: '3%', right: '2%', width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  error: { color: '#FCA5A5', marginTop: 10, fontWeight: '600' },
  hint: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 12, textAlign: 'center', paddingHorizontal: 24 },
});
