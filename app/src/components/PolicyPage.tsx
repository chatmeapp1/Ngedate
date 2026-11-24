import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ui';
import { colors } from '@/lib/theme';

export type Section = { title: string; body: string };

export function PolicyPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: Section[] }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={title} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 16 }}>
        <Text style={s.updated}>Terakhir diperbarui: {updated}</Text>
        <Text style={s.body}>{intro}</Text>
        {sections.map((sec, i) => (
          <View key={sec.title} style={{ gap: 6 }}>
            <Text style={s.title}>
              {i + 1}. {sec.title}
            </Text>
            <Text style={s.body}>{sec.body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  updated: { color: colors.textDim, fontSize: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  body: { color: colors.textSub, fontSize: 14, lineHeight: 21 },
});
