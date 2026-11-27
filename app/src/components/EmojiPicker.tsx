import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';

// Pisahkan per emoji: variation selector (FE0F), penyambung ZWJ dan warna kulit ikut ke emoji sebelumnya
const split = (str: string) => {
  const out: string[] = [];
  for (const ch of Array.from(str.replace(/\s+/g, ''))) {
    const cp = ch.codePointAt(0) ?? 0;
    const joiner = cp === 0xfe0f || cp === 0x200d || (cp >= 0x1f3fb && cp <= 0x1f3ff);
    if (out.length && (joiner || out[out.length - 1].endsWith('\u200d'))) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
};

const CATEGORIES: { icon: string; items: string[] }[] = [
  {
    icon: '😀',
    items: split('😀😃😄😁😆😅😂🤣🥲😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿👻💀☠️👽🤖💩'),
  },
  {
    icon: '❤️',
    items: split('❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟♥️💋💌🌹🥀🌸🌺🌷🌼🌻🔥✨⭐🌟💫💥💯💢💦💤🎉🎊🎁🎈🎀🥂🍾'),
  },
  {
    icon: '👍',
    items: split('👍👎👌✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋🤝🙏✍️💪🦾👏🙌👐🤲🫶🤏🫰🤌🖕🫵👀👁️👅👄🧠'),
  },
  {
    icon: '🍔',
    items: split('🍎🍊🍋🍌🍉🍇🍓🍒🍑🥭🍍🥥🥝🍅🥑🍔🍟🍕🌭🥪🌮🌯🍜🍝🍣🍱🍙🍚🍛🍦🍩🍪🎂🍰🍫🍬☕🍵🧋🍺🍻🥤🍷🥂'),
  },
  {
    icon: '🐱',
    items: split('🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦄🐝🦋🐢🐍🐬🐳🦈🌈☀️🌙⭐☁️⛈️❄️🌊🍀🌴🌵'),
  },
  {
    icon: '⚽',
    items: split('⚽🏀🏈⚾🎾🏐🎱🏓🏸🥊🎯🎮🎲🎵🎶🎤🎧🎸🎹🎬📷💻📱🚗✈️🚀🏖️🏠💎👑💍👗👠👜🕶️💄🛍️💰'),
  },
];

/** Panel emoji sederhana (tanpa pustaka luar). onPick dipanggil dengan emoji yang diketuk. */
export function EmojiPicker({ onPick, height = 250 }: { onPick: (emoji: string) => void; height?: number }) {
  const [cat, setCat] = useState(0);
  return (
    <View style={[s.wrap, { height }]}>
      <View style={s.tabs}>
        {CATEGORIES.map((c, i) => (
          <Pressable key={c.icon} onPress={() => setCat(i)} style={[s.tab, cat === i && s.tabOn]} hitSlop={4}>
            <Text style={s.tabIcon}>{c.icon}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        key={cat}
        data={CATEGORIES[cat].items}
        keyExtractor={(e, i) => e + i}
        numColumns={8}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => onPick(item)} style={s.cell}>
            <Text style={s.emoji}>{item}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tab: { width: 40, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#EFE7FF' },
  tabIcon: { fontSize: 20 },
  cell: { flex: 1 / 8, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 25 },
});
