import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COUNTRY_LIST, countryName, flag } from '@/lib/countries';
import { colors, radius } from '@/lib/theme';

export function CountryPicker({ value, onChange, label = 'Negara' }: { value?: string | null; onChange: (code: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const insets = useSafeAreaInsets();
  const list = useMemo(
    () => COUNTRY_LIST.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.code === q.toUpperCase()),
    [q]
  );

  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable style={s.field} onPress={() => setOpen(true)}>
        <Text style={{ fontSize: 18 }}>{flag(value)}</Text>
        <Text style={[s.value, !value && { color: colors.textDim }]}>{value ? countryName(value) : 'Pilih negara'}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.textDim} />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[s.sheet, { paddingTop: insets.top + 8 }]}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>Pilih negara</Text>
            <Pressable hitSlop={10} onPress={() => setOpen(false)}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
          </View>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Cari negara"
            placeholderTextColor={colors.textDim}
            style={s.search}
          />
          <FlatList
            data={list}
            keyExtractor={(c) => c.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceAlt }]}
                onPress={() => {
                  onChange(item.code);
                  setOpen(false);
                  setQ('');
                }}
              >
                <Text style={{ fontSize: 22 }}>{flag(item.code)}</Text>
                <Text style={s.rowText}>{item.name}</Text>
                {item.code === value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  label: { color: colors.textSub, fontSize: 13, fontWeight: '700' },
  field: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  value: { flex: 1, color: colors.text, fontSize: 15 },
  sheet: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  search: {
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    marginVertical: 8,
    color: colors.text,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 12 },
  rowText: { flex: 1, color: colors.text, fontSize: 15 },
});
