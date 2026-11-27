import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text as RawText, View } from 'react-native';
import { Text } from '@/components/I18nText';
import { api, errorMessage } from '@/lib/api';
import { getLang } from '@/lib/i18n';
import { colors } from '@/lib/theme';

// Hasil terjemahan yang sudah diminta tetap tersimpan selama app terbuka (tidak minta ulang)
const done = new Map<string, { text: string; same: boolean }>();

/** Tombol "Terjemah" di bawah teks buatan pengguna lain. Menerjemahkan ke bahasa aplikasi. */
export function TranslateLink({ text, light }: { text: string; light?: boolean }) {
  const lang = getLang();
  const key = `${lang}|${text}`;
  const [res, setRes] = useState(done.get(key) ?? null);
  const [show, setShow] = useState(!!done.get(key));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!text.trim()) return null;

  const run = async () => {
    if (res) return setShow(true);
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ text: string; same: boolean }>('/api/translate', { text, to: lang });
      const v = { text: r.text, same: r.same };
      done.set(key, v);
      setRes(v);
      setShow(true);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const color = light ? 'rgba(255,255,255,0.85)' : colors.primary;
  return (
    <View style={s.wrap}>
      {show && res ? (
        <View style={s.box}>
          {res.same ? (
            <Text style={[s.same, { color }]}>Sudah dalam bahasamu</Text>
          ) : (
            <RawText style={[s.result, light && { color: '#fff' }]}>{res.text}</RawText>
          )}
          <Pressable onPress={() => setShow(false)} hitSlop={8}>
            <Text style={[s.link, { color }]}>Tampilkan asli</Text>
          </Pressable>
        </View>
      ) : busy ? (
        <View style={s.row}>
          <ActivityIndicator size="small" color={color} />
          <Text style={[s.link, { color }]}>Menerjemahkan…</Text>
        </View>
      ) : (
        <Pressable onPress={run} hitSlop={8}>
          <Text style={[s.link, { color }]}>{err ?? 'Terjemah'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  link: { fontSize: 12.5, fontWeight: '600' },
  box: { gap: 4, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(120,100,150,0.3)' },
  result: { fontSize: 15, lineHeight: 21, color: colors.text, fontStyle: 'italic' },
  same: { fontSize: 12.5, fontStyle: 'italic' },
});
