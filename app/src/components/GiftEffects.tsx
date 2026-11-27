import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/components/I18nText';
import { GiftIcon } from '@/components/GiftIcon';
import { number } from '@/lib/format';
import type { GiftFx } from '@/lib/giftFx';

const ND = true; // useNativeDriver: semua animasi di sini hanya transform & opacity

export type GiftItem = Extract<GiftFx, { kind: 'gift' }>;
type Done = (key: string) => void;

// ---------------------------------------------------------------------------
// Jenis efek per gift (dari ikon). Gift lain: hujan (biasa) atau ledakan (mewah).
// ---------------------------------------------------------------------------
export type EffectKind = 'rain' | 'luxury' | 'drive' | 'sail' | 'rise';

const BY_ICON: Record<string, EffectKind> = {
  '🏎': 'drive',
  '🚗': 'drive',
  '🛥': 'sail',
  '🚢': 'sail',
  '🏰': 'rise',
};

export function effectKind(fx: GiftItem): EffectKind {
  const icon = (fx.icon || '').replace(/️/g, '');
  return BY_ICON[icon] ?? (fx.luxury ? 'luxury' : 'rain');
}

// Kerangka waktu bersama: t berjalan 0 -> 1 selama `ms`, lalu memudar 0,5 detik
function useRun(fx: GiftItem, ms: number, onDone: Done) {
  const t = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: ND }),
      Animated.timing(out, { toValue: 1, duration: 500, useNativeDriver: ND }),
    ]).start(() => onDone(fx.key));
    const safety = setTimeout(() => onDone(fx.key), ms + 2500); // pengaman jika animasi tersendat
    return () => clearTimeout(safety);
  }, [t, out, ms, onDone, fx.key]);
  const fade = out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return { t, fade };
}

function Backdrop({ t, fade, colors }: { t: Animated.Value; fade: Animated.AnimatedInterpolation<number>; colors: readonly [string, string, ...string[]] }) {
  const appear = t.interpolate({ inputRange: [0, 0.08], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.multiply(appear, fade) }]}>
      <LinearGradient colors={colors} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Hujan: ikon gift berjatuhan dari atas (gift biasa)
// ---------------------------------------------------------------------------
export function RainEffect({ fx, onDone }: { fx: GiftItem; onDone: Done }) {
  const { width, height } = useWindowDimensions();
  const { t, fade } = useRun(fx, 2800, onDone);
  const items = useMemo(
    () =>
      Array.from({ length: Math.min(26, 10 + Math.min(fx.count, 16)) }, () => ({
        x: Math.random() * (width - 50),
        size: 28 + Math.random() * 22,
        delay: Math.random() * 0.45,
        sway: (Math.random() - 0.5) * 70,
        spin: (Math.random() - 0.5) * 240,
      })),
    [width, fx.count]
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {items.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: 0,
            opacity: fade,
            transform: [
              { translateY: t.interpolate({ inputRange: [0, p.delay, 1], outputRange: [-90, -90, height + 90] }) },
              { translateX: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, p.sway, -p.sway] }) },
              { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin}deg`] }) },
            ],
          }}
        >
          <GiftIcon icon={fx.icon} imageUrl={fx.imageUrl} size={p.size} />
        </Animated.View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Mobil: melaju melintasi layar dengan garis kecepatan dan getaran
// ---------------------------------------------------------------------------
export function DriveEffect({ fx, onDone }: { fx: GiftItem; onDone: Done }) {
  const { width, height } = useWindowDimensions();
  const { t, fade } = useRun(fx, 2600, onDone);
  const streaks = useMemo(() => Array.from({ length: 8 }, (_, i) => ({ y: -70 + i * 20 + Math.random() * 8, w: 90 + Math.random() * 110, o: 0.35 + Math.random() * 0.4 })), []);
  const shake = t.interpolate({
    inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    outputRange: [0, 4, -4, 4, -4, 3, -3, 3, -2, 1, 0],
  });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Backdrop t={t} fade={fade} colors={['rgba(15,23,42,0.85)', 'rgba(30,27,75,0.75)', 'rgba(15,23,42,0.85)']} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, justifyContent: 'center' }]}>
        <View style={{ height: 190, justifyContent: 'center' }}>
          {streaks.map((st, i) => (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                top: 95 + st.y,
                width: st.w,
                height: 3,
                borderRadius: 2,
                backgroundColor: `rgba(255,255,255,${st.o})`,
                transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [width + 200, -width * 0.6] }) }],
              }}
            />
          ))}
          <Animated.View
            style={{
              position: 'absolute',
              top: 25,
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 0.3, 0.7, 1], outputRange: [-190, width * 0.3, width * 0.5, width + 190] }) },
                { translateY: shake },
              ],
            }}
          >
            <GiftIcon icon={fx.icon} imageUrl={fx.imageUrl} size={140} />
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Kapal: berlayar di atas ombak
// ---------------------------------------------------------------------------
export function SailEffect({ fx, onDone }: { fx: GiftItem; onDone: Done }) {
  const { width, height } = useWindowDimensions();
  const { t, fade } = useRun(fx, 3400, onDone);
  const bob = t.interpolate({ inputRange: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1], outputRange: [0, -12, 0, 12, 0, -12, 0, 12, 0] });
  // Deretan ikon terpisah (bukan satu teks panjang) supaya tidak terpotong "…"
  const wave = (offset: number, y: number, size: number, op: number) => (
    <Animated.View
      style={{
        position: 'absolute',
        top: y,
        left: -80,
        flexDirection: 'row',
        opacity: op,
        transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [offset, offset - 150] }) }],
      }}
    >
      {Array.from({ length: Math.ceil((width + 400) / (size * 1.15)) }, (_, i) => (
        <Text key={i} style={{ fontSize: size, marginRight: size * 0.15 }}>
          🌊
        </Text>
      ))}
    </Animated.View>
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Backdrop t={t} fade={fade} colors={['rgba(8,47,73,0.88)', 'rgba(7,89,133,0.78)', 'rgba(8,47,73,0.9)']} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <Animated.View
          style={{
            position: 'absolute',
            top: height * 0.34,
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-170, width + 40] }) },
              { translateY: bob },
            ],
          }}
        >
          <GiftIcon icon={fx.icon} imageUrl={fx.imageUrl} size={150} />
        </Animated.View>
        {wave(0, height * 0.34 + 120, 38, 0.95)}
        {wave(-40, height * 0.34 + 150, 34, 0.7)}
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Istana: naik dari bawah dengan kembang api
// ---------------------------------------------------------------------------
function Burst({ t, start, x, y, color }: { t: Animated.Value; start: number; x: number; y: number; color: string }) {
  const p = t.interpolate({ inputRange: [0, start, start + 0.22, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' });
  const op = t.interpolate({ inputRange: [0, start, start + 0.04, start + 0.2, start + 0.24, 1], outputRange: [0, 0, 1, 1, 0, 0] });
  return (
    <>
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2;
        return (
          <Animated.Text
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              fontSize: 22,
              opacity: op,
              color,
              transform: [
                { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * 80] }) },
                { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * 80] }) },
                { scale: p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1.2, 0.6] }) },
              ],
            }}
          >
            ✨
          </Animated.Text>
        );
      })}
    </>
  );
}

export function RiseEffect({ fx, onDone }: { fx: GiftItem; onDone: Done }) {
  const { width, height } = useWindowDimensions();
  const { t, fade } = useRun(fx, 3400, onDone);
  const bursts = useMemo(
    () =>
      [0.18, 0.3, 0.42, 0.54, 0.66, 0.76].map((start, i) => ({
        start,
        x: 40 + ((i * 97) % (width - 90)),
        y: height * (0.14 + ((i * 37) % 26) / 100),
        color: ['#FDE68A', '#F9A8D4', '#C4B5FD', '#86EFAC'][i % 4],
      })),
    [width, height]
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Backdrop t={t} fade={fade} colors={['rgba(46,16,101,0.88)', 'rgba(131,24,67,0.72)', 'rgba(17,10,30,0.9)']} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade, alignItems: 'center', justifyContent: 'center' }]}>
        {bursts.map((b, i) => (
          <Burst key={i} t={t} start={b.start} x={b.x} y={b.y} color={b.color} />
        ))}
        <Animated.View
          style={{
            transform: [
              { translateY: t.interpolate({ inputRange: [0, 0.25, 1], outputRange: [height * 0.3, 0, -12] }) },
              { scale: t.interpolate({ inputRange: [0, 0.25, 0.4, 1], outputRange: [0.3, 1.15, 1, 1.1] }) },
            ],
          }}
        >
          <GiftIcon icon={fx.icon} imageUrl={fx.imageUrl} size={190} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Efek MP4 layar penuh: maksimal 6 detik, lalu memudar halus.
// Jika video gagal dimuat / terlalu lama, onFail -> efek bawaan dipakai.
// ---------------------------------------------------------------------------
export const VIDEO_MAX_MS = 6000;
const VIDEO_FADE_OUT_MS = 700;

export function VideoEffect({ fx, onDone, onFail }: { fx: GiftItem; onDone: Done; onFail: (key: string) => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const player = useVideoPlayer(fx.videoUrl as string, (p) => {
    p.loop = false;
    p.muted = true; // suara gift menyusul bersama pembaruan APK berikutnya
  });

  useEffect(() => {
    let started = false;
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = () => {
      if (finished) return;
      finished = true;
      Animated.timing(opacity, { toValue: 0, duration: VIDEO_FADE_OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: ND }).start(() => {
        try {
          player.pause();
        } catch {
          // player sudah dilepas
        }
        onDone(fx.key);
      });
    };

    const begin = () => {
      if (started || finished) return;
      started = true;
      player.play();
      Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: ND }).start();
      // Lama tayang = durasi video, paling lama 6 detik; pemudaran selesai tepat di batas itu
      const dur = player.duration > 0 ? Math.min(player.duration * 1000, VIDEO_MAX_MS) : VIDEO_MAX_MS;
      timers.push(setTimeout(finish, Math.max(900, dur - VIDEO_FADE_OUT_MS)));
    };

    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') begin();
      else if (status === 'error' && !started) onFail(fx.key);
    });
    const end = player.addListener('playToEnd', finish);
    if (player.status === 'readyToPlay') begin();
    // Tidak siap dalam 4 detik: batalkan, pakai efek bawaan
    timers.push(setTimeout(() => !started && onFail(fx.key), 4000));
    // Pengaman mutlak
    timers.push(setTimeout(finish, VIDEO_MAX_MS + 4500));

    return () => {
      sub.remove();
      end.remove();
      timers.forEach(clearTimeout);
    };
  }, [player, opacity, fx.key, onDone, onFail]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }, fx.blend ? { mixBlendMode: 'screen' } : null]}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
          surfaceType="textureView"
        />
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Banner gift ala live streaming di kiri atas, dengan hitungan combo
// ---------------------------------------------------------------------------
export interface BannerData {
  id: string;
  from: string;
  name: string;
  icon: string | null;
  imageUrl: string | null;
  count: number; // total gift beruntun dari pengirim yang sama
  bump: number; // bertambah tiap combo, memicu animasi angka
  until: number; // kapan banner hilang (ms epoch)
}

export function GiftBanner({ b, onGone }: { b: BannerData; onGone: (id: string, until: number) => void }) {
  const slide = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(slide, { toValue: 1, friction: 7, tension: 80, useNativeDriver: ND }).start();
  }, [slide]);

  useEffect(() => {
    pop.setValue(1.8);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 220, useNativeDriver: ND }).start();
  }, [b.bump, pop]);

  useEffect(() => {
    fade.setValue(1);
    const t = setTimeout(
      () => Animated.timing(fade, { toValue: 0, duration: 450, useNativeDriver: ND }).start(() => onGone(b.id, b.until)),
      Math.max(0, b.until - Date.now())
    );
    return () => clearTimeout(t);
  }, [b.until, b.id, fade, onGone]);

  return (
    <Animated.View
      style={{
        opacity: fade,
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-280, 0] }) }],
      }}
    >
      <LinearGradient colors={['rgba(139,92,246,0.92)', 'rgba(236,72,153,0.92)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.banner}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{(b.from || '?').trim().charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ maxWidth: 130 }}>
          <Text style={s.from} numberOfLines={1}>
            {b.from}
          </Text>
          <Text style={s.sub} numberOfLines={1}>
            mengirim {b.name}
          </Text>
        </View>
        <GiftIcon icon={b.icon} imageUrl={b.imageUrl} size={40} />
        <Animated.Text style={[s.count, { transform: [{ scale: pop }] }]}>x{number(b.count)}</Animated.Text>
      </LinearGradient>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 14, paddingVertical: 6, borderRadius: 999, alignSelf: 'flex-start' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '900', color: '#6D3FE0', fontSize: 16 },
  from: { color: '#fff', fontWeight: '800', fontSize: 13 },
  sub: { color: 'rgba(255,255,255,0.92)', fontSize: 11, fontWeight: '600' },
  count: { color: '#FDE68A', fontWeight: '900', fontSize: 26, fontStyle: 'italic', textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
});
