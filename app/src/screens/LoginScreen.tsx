import React, {useState} from 'react';
import {Alert, KeyboardAvoidingView, Platform} from 'react-native';
import {Button, Card, Input, Label, Muted, Screen, Title} from '../components/ui';
import {useApp} from '../state/AppContext';

export function LoginScreen() {
  const {login, apiUrl, setApiUrl} = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState(apiUrl);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (url !== apiUrl) {
        setApiUrl(url);
      }
      await login(email, password);
    } catch (e) {
      Alert.alert('Sign in failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Title>Uptime</Title>
        <Muted>Sign in on this iPad once. Inspections work offline afterwards.</Muted>
        <Card style={{marginTop: 20}}>
          <Label>Email</Label>
          <Input value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
          <Label>Password</Label>
          <Input value={password} onChangeText={setPassword} secureTextEntry />
          <Label>Server</Label>
          <Input value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} />
          <Button title="Sign in" onPress={submit} loading={busy} disabled={!email || !password} />
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}
