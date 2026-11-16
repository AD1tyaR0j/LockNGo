import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading, useTheme } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';

function RootStack() {
  const { user, ready } = useAuth();
  const t = useTheme();
  if (!ready) return <Loading />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        contentStyle: { backgroundColor: t.bg },
      }}
    >
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="index" options={{ title: 'Smart Locker' }} />
        <Stack.Screen name="outlets/index" options={{ title: 'Find a locker' }} />
        <Stack.Screen name="outlets/[id]" options={{ title: 'Book storage' }} />
        <Stack.Screen name="bookings/index" options={{ title: 'Activity' }} />
        <Stack.Screen name="bookings/[id]/index" options={{ title: 'Booking' }} />
        <Stack.Screen name="bookings/[id]/pay" options={{ title: 'Payment' }} />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" options={{ title: 'Sign in', headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <RootStack />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
