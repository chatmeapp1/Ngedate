import { Text as RNText, TextInput as RNTextInput } from 'react-native';

/** <Text> TANPA terjemahan: dipakai untuk isi buatan pengguna (pesan, bio, komentar). */
export const RawText = RNText;
import type { ComponentProps } from 'react';
import { tr, trChildren } from '@/lib/i18n';

/** <Text> yang menerjemahkan isinya sesuai bahasa aplikasi (lihat lib/i18n.ts). */
export function Text({ children, ...rest }: ComponentProps<typeof RNText>) {
  return <RNText {...rest}>{trChildren(children) as typeof children}</RNText>;
}

/** <TextInput> yang menerjemahkan placeholder-nya. */
export function TextInput({ placeholder, ...rest }: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput {...rest} placeholder={placeholder ? tr(placeholder) : placeholder} />;
}
