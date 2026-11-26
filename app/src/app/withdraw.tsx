import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, Field, GradientButton, Loading, ScreenHeader } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { number } from '@/lib/format';
import { onRealtime } from '@/lib/realtime';
import { colors, radius } from '@/lib/theme';
import type { Withdrawal, WithdrawOptions } from '@/lib/types';

const rp = (n: number) => `Rp ${number(n)}`;
const STATUS: Record<Withdrawal['status'], { label: string; bg: string; fg: string }> = {
  pending: { label: 'Diproses', bg: '#FEF3C7', fg: '#B45309' },
  paid: { label: 'Sudah ditransfer', bg: '#DCFCE7', fg: '#15803D' },
  rejected: { label: 'Ditolak', bg: '#FEE2E2', fg: '#B91C1C' },
  cancelled: { label: 'Dibatalkan', bg: '#F3F4F6', fg: '#6B7280' },
};

const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Withdraw() {
  const insets = useSafeAreaInsets();
  const [opt, setOpt] = useState<WithdrawOptions | null>(null);
  const [history, setHistory] = useState<Withdrawal[]>([]);
  const [editing, setEditing] = useState(false);

  // form rekening
  const [provider, setProvider] = useState<string | null>(null);
  const [accNumber, setAccNumber] = useState('');
  const [accName, setAccName] = useState('');
  const [accPass, setAccPass] = useState('');
  const [accError, setAccError] = useState<string | null>(null);
  const [savingAcc, setSavingAcc] = useState(false);

  // form pengajuan
  const [amount, setAmount] = useState('');
  const [reqError, setReqError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const [o, h] = await Promise.all([
      api.get<WithdrawOptions>('/api/withdrawals/options').catch((e) => {
        Alert.alert('Tidak bisa membuka penarikan', errorMessage(e), [{ text: 'OK', onPress: () => router.back() }]);
        return null;
      }),
      api.get<Withdrawal[]>('/api/withdrawals').catch(() => [] as Withdrawal[]),
    ]);
    if (o) {
      setOpt(o);
      if (!o.account) setEditing(true);
    }
    setHistory(h);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  useEffect(() => onRealtime('withdrawal:update', () => load()), [load]);
  useEffect(() => onRealtime('wallet:update', () => load()), [load]);

  if (!opt) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScreenHeader title="Tarik diamond" />
        <Loading />
      </View>
    );
  }

  const diamonds = Math.floor(Number(amount.replace(/\D/g, '')) || 0);
  const gross = diamonds * opt.rateIdr;
  const fee = Math.floor((gross * opt.feePercent) / 100);
  const net = gross - fee;
  const cooldown = opt.account?.cooldownUntil ? new Date(opt.account.cooldownUntil) : null;
  const canRequest =
    !opt.pending && !!opt.account && opt.passwordSet && !cooldown && diamonds >= opt.minDiamonds && diamonds <= opt.diamonds;

  const saveAccount = async () => {
    if (!provider) return setAccError('Pilih bank atau e-wallet');
    setAccError(null);
    setSavingAcc(true);
    try {
      const r = await api.put<{ cooldownUntil: string | null }>('/api/withdrawals/account', {
        provider,
        accountNumber: accNumber,
        accountName: accName.trim(),
        password: accPass,
      });
      setAccPass('');
      setAccNumber('');
      setEditing(false);
      await load();
      Alert.alert(
        'Rekening disimpan',
        r.cooldownUntil ? `Demi keamanan, penarikan bisa diajukan lagi setelah ${opt.cooldownHours} jam sejak rekening diubah.` : 'Sekarang kamu bisa mengajukan penarikan.'
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PASSWORD_REQUIRED') setAccError(e.message);
      else setAccError(errorMessage(e));
    } finally {
      setSavingAcc(false);
    }
  };

  const submit = () => {
    if (!canRequest || sending || !opt.account) return;
    Alert.alert(
      'Ajukan penarikan?',
      `${number(diamonds)} diamond → ${rp(net)}\nke ${opt.account.provider} ${opt.account.accountNumber} a.n. ${opt.account.accountName}.\n\nDiamond langsung dipotong dan transfer diproses admin. Kamu bisa membatalkan selama belum diproses.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Ajukan',
          onPress: async () => {
            setSending(true);
            setReqError(null);
            try {
              await api.post('/api/withdrawals', { diamonds });
              setAmount('');
              await load();
            } catch (e) {
              setReqError(errorMessage(e));
            } finally {
              setSending(false);
            }
          },
        },
      ]
    );
  };

  const cancel = (w: Withdrawal) => {
    Alert.alert('Batalkan penarikan?', 'Diamond yang ditahan akan dikembalikan ke saldomu.', [
      { text: 'Tidak', style: 'cancel' },
      {
        text: 'Batalkan',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.post(`/api/withdrawals/${w.id}/cancel`);
            await load();
          } catch (e) {
            Alert.alert('Gagal', errorMessage(e));
          }
        },
      },
    ]);
  };

  const banks = opt.providers.filter((p) => p.kind === 'bank');
  const wallets = opt.providers.filter((p) => p.kind === 'ewallet');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Tarik diamond" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 16 }} keyboardShouldPersistTaps="handled">
          {/* Saldo */}
          <View style={s.balance}>
            <Text style={{ fontSize: 30 }}>💎</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.balanceLabel}>Diamond yang bisa ditarik</Text>
              <Text style={s.balanceValue}>{number(opt.diamonds)}</Text>
            </View>
          </View>
          <Text style={s.rateText}>
            1 💎 = {rp(opt.rateIdr)} · minimal {number(opt.minDiamonds)} 💎 ({rp(opt.minDiamonds * opt.rateIdr)}){opt.feePercent > 0 ? ` · biaya ${opt.feePercent}%` : ''}
          </Text>

          {/* Perlu password */}
          {!opt.passwordSet ? (
            <View style={s.alert}>
              <Ionicons name="lock-closed-outline" size={20} color="#B45309" />
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={s.alertText}>Atur password dulu untuk melindungi saldo penghasilanmu sebelum menarik diamond.</Text>
                <Pressable onPress={() => router.push('/account-settings')} style={s.alertBtn}>
                  <Text style={s.alertBtnText}>Atur password</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Pengajuan berjalan */}
          {opt.pending ? (
            <View style={s.card}>
              <View style={s.rowBetween}>
                <Text style={s.cardTitle}>Penarikan sedang diproses</Text>
                <Pill status="pending" />
              </View>
              <Text style={s.bigRp}>{rp(opt.pending.netIdr)}</Text>
              <Text style={s.sub}>
                {number(opt.pending.diamonds)} 💎 → {opt.pending.provider} {opt.pending.accountNumber}
              </Text>
              <Text style={s.sub}>Diajukan {when(opt.pending.createdAt)} · biasanya 1–3 hari kerja</Text>
              <Pressable onPress={() => cancel(opt.pending!)} style={s.cancelBtn}>
                <Text style={s.cancelText}>Batalkan pengajuan</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Rekening */}
          <View style={s.card}>
            <View style={s.rowBetween}>
              <Text style={s.cardTitle}>Rekening penarikan</Text>
              {opt.account && !editing ? (
                <Pressable onPress={() => setEditing(true)} hitSlop={8}>
                  <Text style={s.link}>Ubah</Text>
                </Pressable>
              ) : null}
            </View>
            {opt.account && !editing ? (
              <>
                <View style={s.accBox}>
                  <Ionicons name={opt.account.kind === 'bank' ? 'business-outline' : 'wallet-outline'} size={22} color={colors.primaryDark} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.accMain}>
                      {opt.account.provider} · {opt.account.accountNumber}
                    </Text>
                    <Text style={s.sub}>a.n. {opt.account.accountName}</Text>
                  </View>
                </View>
                {cooldown ? (
                  <Text style={s.warn}>Rekening baru diubah. Penarikan bisa diajukan setelah {when(opt.account.cooldownUntil!)}.</Text>
                ) : null}
              </>
            ) : (
              <View style={{ gap: 12 }}>
                <Text style={s.groupLabel}>Bank</Text>
                <View style={s.chips}>
                  {banks.map((p) => (
                    <Chip key={p.name} label={p.name} active={provider === p.name} onPress={() => setProvider(p.name)} />
                  ))}
                </View>
                <Text style={s.groupLabel}>E-wallet</Text>
                <View style={s.chips}>
                  {wallets.map((p) => (
                    <Chip key={p.name} label={p.name} active={provider === p.name} onPress={() => setProvider(p.name)} />
                  ))}
                </View>
                <Field label="Nomor rekening / nomor HP e-wallet" value={accNumber} onChangeText={(t) => setAccNumber(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={20} />
                <Field label="Nama pemilik rekening" value={accName} onChangeText={setAccName} autoCapitalize="words" maxLength={80} />
                <Field label="Password akunmu" value={accPass} onChangeText={setAccPass} secureTextEntry autoCapitalize="none" error={accError} />
                <Text style={s.hint}>Pastikan nama sama dengan nama akun bank/e-wallet. Mengubah rekening menahan penarikan {opt.cooldownHours} jam demi keamanan.</Text>
                <GradientButton title="Simpan rekening" onPress={saveAccount} loading={savingAcc} disabled={!provider || accNumber.length < 5 || accName.trim().length < 3 || !accPass} />
                {opt.account ? (
                  <Pressable onPress={() => setEditing(false)} style={{ alignItems: 'center', paddingVertical: 6 }}>
                    <Text style={s.link}>Batal</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>

          {/* Ajukan */}
          {!opt.pending ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Ajukan penarikan</Text>
              <Field
                label="Jumlah diamond"
                value={amount}
                onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
                keyboardType="number-pad"
                placeholder={`Minimal ${number(opt.minDiamonds)}`}
                error={reqError}
              />
              <View style={s.quick}>
                <Pressable onPress={() => setAmount(String(opt.minDiamonds))} style={s.quickBtn}>
                  <Text style={s.quickText}>Minimal</Text>
                </Pressable>
                <Pressable onPress={() => setAmount(String(opt.diamonds))} style={s.quickBtn}>
                  <Text style={s.quickText}>Semua</Text>
                </Pressable>
              </View>
              {diamonds > 0 ? (
                <View style={s.preview}>
                  <View style={s.rowBetween}>
                    <Text style={s.sub}>
                      {number(diamonds)} 💎 × {rp(opt.rateIdr)}
                    </Text>
                    <Text style={s.previewVal}>{rp(gross)}</Text>
                  </View>
                  {fee > 0 ? (
                    <View style={s.rowBetween}>
                      <Text style={s.sub}>Biaya {opt.feePercent}%</Text>
                      <Text style={s.previewVal}>− {rp(fee)}</Text>
                    </View>
                  ) : null}
                  <View style={[s.rowBetween, { marginTop: 4 }]}>
                    <Text style={s.cardTitle}>Kamu terima</Text>
                    <Text style={s.bigRp}>{rp(net)}</Text>
                  </View>
                </View>
              ) : null}
              {diamonds > 0 && diamonds < opt.minDiamonds ? <Text style={s.warn}>Minimal penarikan {number(opt.minDiamonds)} diamond.</Text> : null}
              {diamonds > opt.diamonds ? <Text style={s.warn}>Diamond kamu tidak cukup.</Text> : null}
              <GradientButton title="Ajukan penarikan" onPress={submit} loading={sending} disabled={!canRequest} />
              {!opt.account ? <Text style={s.hint}>Simpan rekening penarikan dulu.</Text> : null}
            </View>
          ) : null}

          {/* Riwayat */}
          <Text style={s.section}>Riwayat penarikan</Text>
          {history.length === 0 ? (
            <Text style={s.hint}>Belum ada penarikan.</Text>
          ) : (
            history.map((w) => (
              <View key={w.id} style={s.hist}>
                <View style={s.rowBetween}>
                  <Text style={s.histRp}>{rp(w.netIdr)}</Text>
                  <Pill status={w.status} />
                </View>
                <Text style={s.sub}>
                  {number(w.diamonds)} 💎 · {w.provider} {w.accountNumber}
                </Text>
                <Text style={s.hint}>{when(w.createdAt)}</Text>
                {w.status === 'paid' && w.transferRef ? <Text style={s.hint}>Ref transfer: {w.transferRef}</Text> : null}
                {w.status === 'rejected' && w.adminNote ? <Text style={s.warn}>Alasan: {w.adminNote}. Diamond sudah dikembalikan.</Text> : null}
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Pill({ status }: { status: Withdrawal['status'] }) {
  const st = STATUS[status];
  return (
    <View style={[s.pill, { backgroundColor: st.bg }]}>
      <Text style={[s.pillText, { color: st.fg }]}>{st.label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  balance: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F3E8FF', borderRadius: radius.lg, padding: 18 },
  balanceLabel: { color: colors.textSub, fontWeight: '700' },
  balanceValue: { color: colors.text, fontSize: 32, fontWeight: '900' },
  rateText: { color: colors.textSub, fontSize: 13, textAlign: 'center', marginTop: -6 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 16, gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sub: { color: colors.textSub, fontSize: 13 },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  warn: { color: '#B45309', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  link: { color: colors.primary, fontWeight: '800' },
  bigRp: { fontSize: 24, fontWeight: '900', color: colors.text },
  accBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 12 },
  accMain: { fontSize: 16, fontWeight: '800', color: colors.text },
  groupLabel: { fontSize: 12, fontWeight: '800', color: colors.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quick: { flexDirection: 'row', gap: 8, marginTop: -4 },
  quickBtn: { paddingHorizontal: 14, height: 32, borderRadius: radius.pill, backgroundColor: '#EDE3FF', alignItems: 'center', justifyContent: 'center' },
  quickText: { color: colors.primaryDark, fontWeight: '800', fontSize: 13 },
  preview: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 12, gap: 4 },
  previewVal: { fontWeight: '700', color: colors.text },
  alert: { flexDirection: 'row', gap: 10, backgroundColor: '#FEF3C7', borderRadius: radius.md, padding: 14 },
  alertText: { color: '#92400E', lineHeight: 20 },
  alertBtn: { alignSelf: 'flex-start', backgroundColor: '#F59E0B', paddingHorizontal: 14, height: 34, borderRadius: radius.pill, justifyContent: 'center' },
  alertBtnText: { color: '#fff', fontWeight: '800' },
  cancelBtn: { alignSelf: 'flex-start', paddingHorizontal: 14, height: 36, borderRadius: radius.pill, backgroundColor: '#FEE2E2', justifyContent: 'center' },
  cancelText: { color: '#B91C1C', fontWeight: '800' },
  section: { fontSize: 13, fontWeight: '800', color: colors.textSub, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6 },
  hist: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 4 },
  histRp: { fontSize: 18, fontWeight: '900', color: colors.text },
  pill: { paddingHorizontal: 10, height: 24, borderRadius: radius.pill, justifyContent: 'center' },
  pillText: { fontSize: 12, fontWeight: '800' },
});
