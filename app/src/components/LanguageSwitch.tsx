import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { getLang, setLang, type Lang } from '@/lib/i18n';
import { colors } from '@/lib/theme';

const OPTIONS: { code: Lang; label: string }[] = [
  { code: 'id', label: 'Indonesia' },
  { code: 'en', label: 'English' },
];

/** Pilihan bahasa aplikasi. Mengganti bahasa membuat layar dimuat ulang dengan bahasa baru. */
export function LanguageSwitch({ compact }: { compact?: boolean }) {
  const cur = getLang();
  return (
    <View style={[s.row, compact && { gap: 4 }]}>
      {OPTIONS.map((o) => {
        const on = cur === o.code;
        return (
          <Pressable key={o.code} onPress={() => !on && setLang(o.code)} style={[s.pill, compact && s.compact, on && s.on]}>
            <Text style={[s.text, compact && { fontSize: 12 }, on && s.textOn]}>{compact ? o.code.toUpperCase() : o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  pill: { flex: 1, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  compact: { flex: 0, minWidth: 40, height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.22)', borderColor: 'rgba(255,255,255,0.4)' },
  on: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { fontSize: 14, fontWeight: '600', color: colors.text },
  textOn: { color: '#fff' },
});
