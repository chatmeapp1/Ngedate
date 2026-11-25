import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

// Centang biru untuk host yang lolos verifikasi wajah
export function Verified({ size = 16, outline = true }: { size?: number; outline?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: outline ? '#fff' : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="checkmark-circle" size={size} color="#1D9BF0" />
    </View>
  );
}
