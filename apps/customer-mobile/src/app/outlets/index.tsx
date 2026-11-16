import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { OutletSummary } from '@sl/shared';
import { Banner, Button, Card, Loading, P, Pill, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

export default function Outlets() {
  const [items, setItems] = useState<OutletSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setItems((await api.outlets()).items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load outlets');
    }
  };
  useEffect(() => {
    void load();
  }, []);

  if (error) {
    return (
      <Screen>
        <Banner tone="error">{error}</Banner>
        <Button variant="secondary" title="Try again" onPress={load} />
      </Screen>
    );
  }
  if (!items) return <Loading />;
  // Location-based sorting needs a maps provider + location consent; listed by city for now.
  const cities = [...new Set(items.map((o) => o.city))];
  return (
    <Screen>
      {items.length === 0 ? <P muted>No lockers are open for booking yet.</P> : null}
      {cities.map((city) => (
        <View key={city} style={{ gap: 10 }}>
          <P muted style={{ fontWeight: '700' }}>
            {city}
          </P>
          {items
            .filter((o) => o.city === city)
            .map((o) => (
              <Pressable
                key={o.id}
                accessibilityRole="button"
                onPress={() => router.push(`/outlets/${o.id}`)}
              >
                <Card>
                  <P style={{ fontWeight: '700' }}>{o.name}</P>
                  <P muted>{o.address}</P>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <Pill
                      label={
                        o.operatingHours.is24x7
                          ? 'Open 24×7'
                          : `${o.operatingHours.open}–${o.operatingHours.close}`
                      }
                    />
                    {o.hasSimulatedDevices ? <Pill label="SIMULATED LOCKER" tone="sim" /> : null}
                  </View>
                </Card>
              </Pressable>
            ))}
        </View>
      ))}
    </Screen>
  );
}
