import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useState, type ReactNode } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientButton } from '@/components/ui';
import { colors, radius } from '@/lib/theme';

// ---------- Tanggal ----------
const pad = (n: number) => String(n).padStart(2, '0');
export const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function maxBirthDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d;
}

/** Tombol pemilih tanggal lahir (minimal 18 tahun). Android: dialog kalender bawaan. */
export function BirthDatePicker({ value, onChange, children }: { value: string | null; onChange: (iso: string) => void; children: (open: () => void) => ReactNode }) {
  const [show, setShow] = useState(false);
  const initial = value ? new Date(`${value}T00:00:00`) : new Date(2000, 0, 1);
  const onPick = (e: DateTimePickerEvent, d?: Date) => {
    setShow(Platform.OS === 'ios');
    if (e.type === 'set' && d) onChange(toIsoDate(d));
  };
  return (
    <>
      {children(() => setShow(true))}
      {show ? (
        <DateTimePicker value={initial} mode="date" display="spinner" maximumDate={maxBirthDate()} minimumDate={new Date(1940, 0, 1)} onChange={onPick} />
      ) : null}
    </>
  );
}

// ---------- Bottom sheet dasar ----------
function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{title}</Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- Teks (nickname, bio) ----------
export function TextEditor({
  visible,
  title,
  initial,
  maxLength,
  multiline,
  minLength = 1,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  initial: string;
  maxLength: number;
  multiline?: boolean;
  minLength?: number;
  onClose: () => void;
  onSave: (v: string) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <TextInput
        value={text}
        onChangeText={setText}
        autoFocus
        multiline={multiline}
        maxLength={maxLength}
        placeholderTextColor={colors.textDim}
        style={[s.input, multiline && { height: 120, textAlignVertical: 'top', paddingTop: 12 }]}
      />
      <Text style={s.counter}>
        {text.length}/{maxLength}
      </Text>
      <GradientButton
        title="Simpan"
        loading={saving}
        disabled={text.trim().length < minLength}
        onPress={async () => {
          setSaving(true);
          try {
            await onSave(text.trim());
            onClose();
          } finally {
            setSaving(false);
          }
        }}
      />
    </Sheet>
  );
}

// ---------- Bahasa ----------
export const LANGUAGES: Record<string, string> = {
  id: 'Indonesia', en: 'English', ms: 'Melayu', th: 'ไทย (Thai)', vi: 'Tiếng Việt', tl: 'Filipino',
  zh: '中文 (Mandarin)', ja: '日本語 (Jepang)', ko: '한국어 (Korea)', ar: 'العربية (Arab)', hi: 'हिन्दी (Hindi)',
  es: 'Español', pt: 'Português',
};

export function LanguagePicker({ visible, value, onClose, onPick }: { visible: boolean; value: string; onClose: () => void; onPick: (code: string) => void }) {
  return (
    <Sheet visible={visible} title="Bahasa" onClose={onClose}>
      <FlatList
        style={{ maxHeight: 420 }}
        data={Object.entries(LANGUAGES)}
        keyExtractor={([code]) => code}
        renderItem={({ item: [code, name] }) => (
          <Pressable
            style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceAlt }]}
            onPress={() => {
              onPick(code);
              onClose();
            }}
          >
            <Text style={s.rowText}>{name}</Text>
            {code === value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          </Pressable>
        )}
      />
    </Sheet>
  );
}

// ---------- Tag ----------
export const SUGGESTED_TAGS = ['musik', 'film', 'kuliner', 'travel', 'olahraga', 'game', 'kopi', 'kucing', 'anime', 'k-pop', 'fotografi', 'baca buku'];

export function TagEditor({ visible, initial, onClose, onSave }: { visible: boolean; initial: string[]; onClose: () => void; onSave: (tags: string[]) => Promise<void> }) {
  const [tags, setTags] = useState<string[]>(initial);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (visible) setTags(initial);
  }, [visible, initial]);
  const toggle = (t: string) =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 8 ? cur : [...cur, t]));
  const add = () => {
    const t = text.trim().toLowerCase().slice(0, 20);
    if (t) toggle(t);
    setText('');
  };
  const all = [...new Set([...tags, ...SUGGESTED_TAGS])];
  return (
    <Sheet visible={visible} title={`Tag saya (${tags.length}/8)`} onClose={onClose}>
      <View style={s.tags}>
        {all.map((t) => {
          const on = tags.includes(t);
          return (
            <Pressable key={t} onPress={() => toggle(t)} style={[s.tag, on && s.tagOn]}>
              <Text style={[s.tagText, on && { color: '#fff' }]}>#{t}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 12 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          placeholder="Tag lain…"
          placeholderTextColor={colors.textDim}
          maxLength={20}
          style={[s.input, { flex: 1 }]}
        />
        <Pressable onPress={add} style={s.addBtn}>
          <Ionicons name="add" size={24} color="#fff" />
        </Pressable>
      </View>
      <GradientButton
        title="Simpan"
        loading={saving}
        onPress={async () => {
          setSaving(true);
          try {
            await onSave(tags);
            onClose();
          } finally {
            setSaving(false);
          }
        }}
      />
    </Sheet>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
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
  counter: { alignSelf: 'flex-end', color: colors.textDim, fontSize: 12, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 6, borderRadius: 10 },
  rowText: { color: colors.text, fontSize: 15 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingHorizontal: 12, height: 34, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  tagOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tagText: { color: colors.textSub, fontWeight: '700', fontSize: 13 },
  addBtn: { width: 50, height: 50, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
