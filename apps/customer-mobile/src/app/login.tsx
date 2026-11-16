import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Banner, Button, Card, H1, P, Screen, useTheme } from '../components/ui';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export default function LoginScreen() {
  const { signIn, register } = useAuth();
  const t = useTheme();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else await register(name.trim(), email.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const input = [
    styles.input,
    { color: t.text, borderColor: t.border, backgroundColor: t.surface },
  ];
  return (
    <Screen>
      <View style={{ height: 40 }} />
      <H1>Smart Locker</H1>
      <P muted>Store your bags at a locker near you.</P>
      <Card>
        {mode === 'register' ? (
          <View style={styles.field}>
            <Text style={{ color: t.muted }}>Name</Text>
            <TextInput
              testID="name"
              style={input}
              value={name}
              onChangeText={setName}
              autoComplete="name"
            />
          </View>
        ) : null}
        <View style={styles.field}>
          <Text style={{ color: t.muted }}>Email</Text>
          <TextInput
            testID="email"
            style={input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
        </View>
        <View style={styles.field}>
          <Text style={{ color: t.muted }}>
            Password{mode === 'register' ? ' (at least 10 characters)' : ''}
          </Text>
          <TextInput
            testID="password"
            style={input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onSubmitEditing={submit}
          />
        </View>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Button
          testID="submit"
          title={mode === 'login' ? 'Sign in' : 'Create account'}
          onPress={submit}
          loading={busy}
        />
        <Button
          variant="secondary"
          title={mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
          onPress={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        />
      </Card>
      <P muted style={{ fontSize: 13 }}>
        Phone/OTP sign-in will be added once an SMS provider is approved.
      </P>
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 48, paddingHorizontal: 12, fontSize: 16 },
});
