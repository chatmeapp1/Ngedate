import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CountryPicker } from '@/components/CountryPicker';
import { Avatar, Chip, Field, GradientButton, ScreenHeader } from '@/components/ui';
import { useAuth } from '@/context/auth';
import { api, errorMessage, imageForm } from '@/lib/api';
import { colors, radius } from '@/lib/theme';
import type { Photo, User } from '@/lib/types';

async function pickImage(aspect?: [number, number]) {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect,
    quality: 0.8,
  });
  return res.canceled ? null : res.assets[0];
}

export default function EditProfile() {
  const insets = useSafeAreaInsets();
  const { user, setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [gender, setGender] = useState(user?.gender ?? null);
  const [birthDate, setBirthDate] = useState(user?.birthDate ? user.birthDate.slice(0, 10) : '');
  const [country, setCountry] = useState(user?.countryCode ?? null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'avatar' | 'photo' | null>(null);

  useEffect(() => {
    api.get<Photo[]>('/api/me/photos').then(setPhotos).catch(() => {});
  }, []);

  if (!user) return null;

  const changeAvatar = async () => {
    const asset = await pickImage([1, 1]);
    if (!asset) return;
    setUploading('avatar');
    try {
      setUser(await api.post<User>('/api/me/avatar', imageForm(asset.uri, asset.mimeType)));
    } catch (e) {
      Alert.alert('Gagal mengunggah', errorMessage(e));
    } finally {
      setUploading(null);
    }
  };

  const addPhoto = async () => {
    const asset = await pickImage([4, 5]);
    if (!asset) return;
    setUploading('photo');
    try {
      const p = await api.post<Photo>('/api/me/photos', imageForm(asset.uri, asset.mimeType));
      setPhotos((list) => [...list, p]);
    } catch (e) {
      Alert.alert('Gagal mengunggah', errorMessage(e));
    } finally {
      setUploading(null);
    }
  };

  const removePhoto = (p: Photo) =>
    Alert.alert('Hapus foto?', '', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          await api.del(`/api/me/photos/${p.id}`).catch(() => {});
          setPhotos((list) => list.filter((x) => x.id !== p.id));
        },
      },
    ]);

  const save = async () => {
    if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      Alert.alert('Tanggal lahir', 'Gunakan format TAHUN-BULAN-TANGGAL, contoh 1998-07-25');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.patch<User>('/api/me', {
        displayName: displayName.trim(),
        bio: bio.trim(),
        ...(gender ? { gender } : {}),
        ...(birthDate ? { birthDate } : {}),
        ...(country ? { countryCode: country } : {}),
      });
      setUser(updated);
      Alert.alert('Tersimpan', 'Profil berhasil diperbarui');
    } catch (e) {
      Alert.alert('Gagal menyimpan', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Edit profil" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <Pressable style={s.avatarWrap} onPress={changeAvatar}>
          <Avatar uri={user.avatarUrl} name={user.displayName} size={104} />
          <View style={s.camera}>
            {uploading === 'avatar' ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="camera" size={18} color="#fff" />}
          </View>
        </Pressable>

        <Field label="Nama tampilan" value={displayName} onChangeText={setDisplayName} maxLength={50} />
        <Field label="Bio" value={bio} onChangeText={setBio} multiline maxLength={500} style={{ height: 96, paddingTop: 12, textAlignVertical: 'top' }} placeholder="Ceritakan sedikit tentang dirimu" />

        <View style={{ gap: 6 }}>
          <Text style={s.label}>Jenis kelamin</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Chip label="Perempuan" icon="female" active={gender === 'female'} onPress={() => setGender('female')} />
            <Chip label="Laki-laki" icon="male" active={gender === 'male'} onPress={() => setGender('male')} />
          </View>
        </View>

        <Field label="Tanggal lahir (minimal 18 tahun)" value={birthDate} onChangeText={setBirthDate} placeholder="1998-07-25" keyboardType="numbers-and-punctuation" maxLength={10} />
        <CountryPicker value={country} onChange={setCountry} />

        <View style={{ gap: 8 }}>
          <Text style={s.label}>Album foto ({photos.length}/12)</Text>
          <View style={s.album}>
            {photos.map((p) => (
              <Pressable key={p.id} style={s.cell} onLongPress={() => removePhoto(p)} onPress={() => removePhoto(p)}>
                <Image source={{ uri: p.url }} style={s.img} contentFit="cover" />
                <View style={s.remove}>
                  <Ionicons name="close" size={14} color="#fff" />
                </View>
              </Pressable>
            ))}
            {photos.length < 12 ? (
              <Pressable style={s.cell} onPress={addPhoto}>
                <View style={[s.img, s.add]}>
                  {uploading === 'photo' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="add" size={30} color={colors.primary} />}
                </View>
              </Pressable>
            ) : null}
          </View>
        </View>

        <GradientButton title="Simpan" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  avatarWrap: { alignSelf: 'center' },
  camera: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
  },
  label: { color: colors.textSub, fontSize: 13, fontWeight: '700' },
  album: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  cell: { width: '33.333%', padding: 4 },
  img: { width: '100%', aspectRatio: 0.8, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: '#F5F0FF' },
  remove: { position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
