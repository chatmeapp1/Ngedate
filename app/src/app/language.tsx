import { ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/components/I18nText';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ScreenHeader } from '@/components/ui';
import { View } from 'react-native';
import { colors } from '@/lib/theme';

export default function LanguageScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Bahasa app" />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={s.card}>
          <LanguageSwitch />
          <Text style={s.hint}>Pilih bahasa aplikasi. Pesan chat bisa diterjemahkan ke bahasa ini.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 22, padding: 16, gap: 12 },
  hint: { color: colors.textSub, fontSize: 14, lineHeight: 20 },
});
