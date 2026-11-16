import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Session token storage.
 * - iOS/Android: OS keychain/keystore via expo-secure-store.
 * - Web (development preview only): memory only. We deliberately avoid localStorage so a
 *   script injection cannot read a long-lived token; the trade-off is re-login on refresh.
 */
const KEY = 'sl.session';
let memory: string | null = null;
const native = Platform.OS === 'ios' || Platform.OS === 'android';

export const tokenStore = {
  async get(): Promise<string | null> {
    return native ? SecureStore.getItemAsync(KEY) : memory;
  },
  async set(token: string): Promise<void> {
    if (native) await SecureStore.setItemAsync(KEY, token);
    else memory = token;
  },
  async clear(): Promise<void> {
    if (native) await SecureStore.deleteItemAsync(KEY);
    else memory = null;
  },
};
