import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';
import { Avatar } from '@/components/ui';

interface Frame {
  colors: readonly [string, string, ...string[]];
  glow: string;
  crown?: 'small' | 'big';
  sparkles?: number;
}

/** Bingkai avatar otomatis menurut tingkat VIP (1-5): makin tinggi makin mewah. */
const FRAMES: Frame[] = [
  { colors: ['#F3D58A', '#C9971C'], glow: '#E8C45A' }, // VIP 1: emas polos
  { colors: ['#F8D36A', '#D9801A', '#F8D36A'], glow: '#F0A93A', sparkles: 1 }, // VIP 2: emas + kilau
  { colors: ['#FFC857', '#E8590C', '#FFC857'], glow: '#F2812F', crown: 'small' }, // VIP 3: mahkota kecil
  { colors: ['#FF9F5A', '#D6336C', '#FF6FA8'], glow: '#E8508C', crown: 'small', sparkles: 2 }, // VIP 4: merah muda + kilau
  { colors: ['#E599F7', '#7048E8', '#F5D78A'], glow: '#9B6BFF', crown: 'big', sparkles: 2 }, // VIP 5: ungu kerajaan
];

/**
 * Avatar bulat dengan bingkai VIP yang terpasang otomatis. Tanpa VIP tampil sebagai avatar biasa.
 * `size` adalah ukuran foto; bingkai menambah sedikit di sekelilingnya.
 */
export function FramedAvatar({ uri, name, size = 40, vip = 0 }: { uri?: string | null; name?: string; size?: number; vip?: number }) {
  const frame = vip > 0 ? FRAMES[Math.min(vip, FRAMES.length) - 1] : null;
  if (!frame) return <Avatar uri={uri} name={name} size={size} />;

  const ring = Math.max(2.5, size * 0.075);
  const gap = Math.max(1.5, size * 0.03);
  const inner = size + gap * 2;
  const outer = inner + ring * 2;
  const crown = frame.crown === 'big' ? outer * 0.5 : outer * 0.4;

  return (
    <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center', marginTop: frame.crown ? crown * 0.45 : 0 }}>
      <LinearGradient
        colors={frame.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: 'absolute',
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          shadowColor: frame.glow,
          shadowOpacity: 0.7,
          shadowRadius: outer * 0.16,
          shadowOffset: { width: 0, height: 0 },
          elevation: 5,
        }}
      />
      <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <Avatar uri={uri} name={name} size={size} />
      </View>
      {frame.crown ? (
        <MaterialCommunityIcons
          name="crown"
          size={crown}
          color={frame.crown === 'big' ? '#FFD84D' : '#FFC83D'}
          style={{ position: 'absolute', top: -crown * 0.62, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 3 }}
        />
      ) : null}
      {frame.sparkles ? (
        <MaterialCommunityIcons name="star-four-points" size={outer * 0.2} color="#fff" style={{ position: 'absolute', right: -outer * 0.02, top: outer * 0.06 }} />
      ) : null}
      {frame.sparkles && frame.sparkles > 1 ? (
        <MaterialCommunityIcons name="star-four-points" size={outer * 0.14} color="#fff" style={{ position: 'absolute', left: outer * 0.02, bottom: outer * 0.1 }} />
      ) : null}
    </View>
  );
}
