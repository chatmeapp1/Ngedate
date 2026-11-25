import * as ImagePicker from 'expo-image-picker';

// Pilih foto dari galeri (dengan potong/crop)
export async function pickImage(aspect?: [number, number]) {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect,
    quality: 0.8,
  });
  return res.canceled ? null : res.assets[0];
}
