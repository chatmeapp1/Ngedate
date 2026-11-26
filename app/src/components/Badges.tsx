import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Icon = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Warna & lambang tiap level (0-10): makin tinggi makin mewah. */
export const LEVEL_STYLES: { colors: readonly [string, string]; ring: string; icon: Icon }[] = [
  { colors: ['#B4BAC6', '#6B7280'], ring: '#E5E7EB', icon: 'diamond-stone' }, // 0 perak
  { colors: ['#8EA0FF', '#4F46E5'], ring: '#C7D2FE', icon: 'diamond-stone' }, // 1 indigo
  { colors: ['#4ADE9F', '#059669'], ring: '#A7F3D0', icon: 'diamond-stone' }, // 2 zamrud
  { colors: ['#4CC9FF', '#2563EB'], ring: '#BAE6FD', icon: 'diamond' }, // 3 safir
  { colors: ['#FF7EC2', '#DB2777'], ring: '#FBCFE8', icon: 'diamond' }, // 4 pink
  { colors: ['#FF8A8A', '#DC2626'], ring: '#FECACA', icon: 'star-four-points' }, // 5 ruby
  { colors: ['#FFE066', '#F59E0B'], ring: '#FEF3C7', icon: 'star-circle' }, // 6 emas
  { colors: ['#C58BFF', '#7C3AED'], ring: '#E9D5FF', icon: 'star-circle' }, // 7 amethyst
  { colors: ['#FFB067', '#EA580C'], ring: '#FED7AA', icon: 'shield-star' }, // 8 oranye
  { colors: ['#FF5C7A', '#9F1239'], ring: '#FDE68A', icon: 'crown' }, // 9 kerajaan
  { colors: ['#A855F7', '#3B0764'], ring: '#FDE047', icon: 'crown' }, // 10 raja
];

export function levelStyle(level: number) {
  return LEVEL_STYLES[Math.max(0, Math.min(LEVEL_STYLES.length - 1, level))];
}

/** Lencana level: lambang bulat bercincin + angka pada pil gradasi. */
export function LevelBadge({ level, size = 26 }: { level: number; size?: number }) {
  const st = levelStyle(level);
  const emblem = size * 1.18;
  return (
    <View style={{ height: emblem, justifyContent: 'center', paddingLeft: emblem * 0.5, alignSelf: 'flex-start' }}>
      <LinearGradient
        colors={st.colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ height: size, minWidth: size * 2.1, borderRadius: size / 2, paddingLeft: emblem * 0.62, paddingRight: size * 0.5, justifyContent: 'center' }}
      >
        <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.6, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } }}>
          {level}
        </Text>
      </LinearGradient>
      <View style={{ position: 'absolute', left: 0, width: emblem, height: emblem, borderRadius: emblem / 2, borderWidth: Math.max(2, size * 0.1), borderColor: st.ring, overflow: 'hidden' }}>
        <LinearGradient colors={[st.colors[0], st.colors[1]]} style={s.center}>
          <MaterialCommunityIcons name={st.icon} size={emblem * 0.58} color="#fff" />
        </LinearGradient>
      </View>
    </View>
  );
}

const VIP_COLORS: readonly (readonly [string, string])[] = [
  ['#F3D58A', '#C9971C'], // VIP 1
  ['#F8D36A', '#D9801A'], // VIP 2
  ['#FFC857', '#E8590C'], // VIP 3
  ['#FF9F5A', '#D6336C'], // VIP 4
  ['#E599F7', '#7048E8'], // VIP 5
];

export function vipColors(vip: number) {
  return VIP_COLORS[Math.max(1, Math.min(VIP_COLORS.length, vip)) - 1];
}

/** Lencana VIP 1-5 (mahkota emas). */
export function VipBadge({ vip, size = 22 }: { vip: number; size?: number }) {
  if (vip < 1) return null;
  const c = vipColors(vip);
  return (
    <LinearGradient colors={c} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.vip, { height: size, borderRadius: size / 2, paddingHorizontal: size * 0.4, gap: size * 0.18 }]}>
      <MaterialCommunityIcons name="crown" size={size * 0.7} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.52, letterSpacing: 0.3 }}>VIP {vip}</Text>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  vip: { flexDirection: 'row', alignItems: 'center' },
});
