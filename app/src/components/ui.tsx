import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, radius } from '@/lib/theme';

// ---------- Tombol ----------
export function GradientButton({
  title,
  onPress,
  loading,
  disabled,
  icon,
  style,
  children,
}: {
  title?: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: ComponentProps<typeof Ionicons>['name'];
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const off = disabled || loading;
  return (
    <Pressable onPress={onPress} disabled={off} style={({ pressed }) => [style, { opacity: off ? 0.55 : pressed ? 0.85 : 1 }]}>
      <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btn}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={20} color="#fff" /> : null}
            {children ?? <Text style={s.btnText}>{title}</Text>}
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function GhostButton({ title, onPress, danger }: { title: string; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.ghost, pressed && { opacity: 0.7 }]}>
      <Text style={[s.ghostText, danger && { color: colors.danger }]}>{title}</Text>
    </Pressable>
  );
}

// ---------- Koin ----------
export function Coin({ size = 14 }: { size?: number }) {
  return (
    <View style={[s.coin, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ fontSize: size * 0.6, color: '#7A4A00', fontWeight: '900' }}>A</Text>
    </View>
  );
}

// ---------- Avatar ----------
export function Avatar({ uri, name, size = 44 }: { uri?: string | null; name?: string; size?: number }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <LinearGradient colors={gradients.brand} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.42 }}>{initial}</Text>
    </LinearGradient>
  );
}

// ---------- Input ----------
export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textDim}
        selectionColor={colors.primary}
        autoCorrect={false}
        {...props}
        style={[s.input, error ? { borderColor: colors.danger } : null, props.style]}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

// ---------- Chip / tab ----------
export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: ComponentProps<typeof Ionicons>['name'] }) {
  return (
    <Pressable onPress={onPress}>
      {active ? (
        <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.chip}>
          {icon ? <Ionicons name={icon} size={15} color="#fff" /> : null}
          <Text style={[s.chipText, { color: '#fff' }]}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={[s.chip, s.chipOff]}>
          {icon ? <Ionicons name={icon} size={15} color={colors.textSub} /> : null}
          <Text style={s.chipText}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------- Header halaman ----------
export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.header, { paddingTop: insets.top + 8 }]}>
      <Pressable hitSlop={12} onPress={() => router.back()} style={s.headerBtn}>
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </Pressable>
      <Text style={s.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={s.headerBtn}>{right}</View>
    </View>
  );
}

// ---------- Kosong / memuat ----------
export function Empty({ icon = 'sparkles-outline', title, subtitle }: { icon?: ComponentProps<typeof Ionicons>['name']; title: string; subtitle?: string }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={40} color={colors.textDim} />
      <Text style={s.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={s.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={s.empty}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const s = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  ghost: { height: 48, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  coin: { backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFD86B' },
  label: { color: colors.textSub, fontSize: 13, fontWeight: '700' },
  input: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 15,
  },
  error: { color: colors.danger, fontSize: 12 },
  chip: { height: 38, borderRadius: radius.pill, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.textSub, fontWeight: '700', fontSize: 14 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, backgroundColor: colors.bg },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: colors.text },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 8, paddingHorizontal: 24 },
  emptyTitle: { color: colors.textSub, fontWeight: '700', fontSize: 15, textAlign: 'center' },
  emptySub: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
});
