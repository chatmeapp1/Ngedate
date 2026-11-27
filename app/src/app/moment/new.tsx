import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/I18nText';
import { ScreenHeader } from '@/components/ui';
import { api, errorMessage, imageForm } from '@/lib/api';
import { pickImage } from '@/lib/pickImage';
import { colors } from '@/lib/theme';

/** Host: posting momen (foto dan/atau teks). */
export default function NewMoment() {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; mimeType?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const can = (text.trim().length > 0 || !!photo) && !busy;

  const pick = async () => {
    const a = await pickImage();
    if (a) setPhoto({ uri: a.uri, mimeType: a.mimeType });
  };

  const post = async () => {
    if (!can) return;
    setBusy(true);
    try {
      const form = photo ? imageForm(photo.uri, photo.mimeType) : new FormData();
      if (text.trim()) form.append('body', text.trim());
      await api.post('/api/moments', form);
      if (photo) Alert.alert('Terkirim', 'Foto akan tampil ke pengguna setelah disetujui admin.');
      router.back();
    } catch (e) {
      Alert.alert('Gagal memposting', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader
        title="Posting momen"
        right={
          <Pressable onPress={post} disabled={!can} hitSlop={10}>
            {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={[s.send, !can && { opacity: 0.35 }]}>Kirim</Text>}
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Tulis sesuatu…"
          placeholderTextColor={colors.textDim}
          multiline
          maxLength={500}
          style={s.input}
        />
        <Text style={s.count}>{text.length}/500</Text>

        {photo ? (
          <View style={s.preview}>
            <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <Pressable onPress={() => setPhoto(null)} style={s.remove} hitSlop={8}>
              <Ionicons name="close" size={18} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={pick} style={s.add}>
            <Ionicons name="image-outline" size={30} color={colors.primary} />
            <Text style={s.addText}>Tambah foto</Text>
          </Pressable>
        )}
        <Text style={s.hint}>Jangan mencantumkan nomor telepon, link, atau akun sosial media.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  send: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  input: { minHeight: 110, fontSize: 16, color: colors.text, textAlignVertical: 'top', backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  count: { alignSelf: 'flex-end', color: colors.textDim, fontSize: 12, marginTop: -8 },
  add: { height: 120, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#D9C9F5', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FAF6FF' },
  addText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  preview: { height: 300, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  remove: { position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  hint: { color: colors.textDim, fontSize: 12 },
});
