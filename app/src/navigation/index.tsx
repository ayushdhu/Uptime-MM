import React, {useEffect} from 'react';
import {NavigationContainer, createNavigationContainerRef} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {ActivityIndicator, View} from 'react-native';
import type {RootStackParamList} from './types';
import {useApp} from '../state/AppContext';
import {LoginScreen} from '../screens/LoginScreen';
import {HomeScreen} from '../screens/HomeScreen';
import {SyncScreen} from '../screens/SyncScreen';
import {UnregisteredTagScreen} from '../screens/UnregisteredTagScreen';
import {SetupWizardScreen} from '../screens/SetupWizardScreen';
import {MachineScreen} from '../screens/MachineScreen';
import {WalkthroughScreen} from '../screens/WalkthroughScreen';
import {HighSeverityFlowScreen} from '../screens/HighSeverityFlowScreen';
import {CheckoutScreen} from '../screens/CheckoutScreen';
import {ReportScreen} from '../screens/ReportScreen';
import {InspectionDetailScreen} from '../screens/InspectionDetailScreen';
import {PhotoBrowserScreen} from '../screens/PhotoBrowserScreen';
import {getLaunchTagId} from '../services/nfc';
import {resolveTag} from '../services/tagResolution';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const {ready, user, api, sync} = useApp();

  // Launched by a tag scan (cold start with an NFC intent): route straight to the machine.
  useEffect(() => {
    if (!ready || !user) {
      return;
    }
    (async () => {
      const tagId = await getLaunchTagId();
      if (!tagId) {
        return;
      }
      const res = await resolveTag(tagId, api, sync.online);
      const go = () => {
        if (!navigationRef.isReady()) {
          setTimeout(go, 100);
          return;
        }
        if (res.kind === 'machine') {
          navigationRef.navigate('Machine', {machineId: res.machine.id});
        } else {
          navigationRef.navigate('UnregisteredTag', {tagId});
        }
      };
      go();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

  if (!ready) {
    return (
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{headerBackTitle: 'Back'}}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{headerShown: false}} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} options={{title: 'Uptime'}} />
            <Stack.Screen name="Sync" component={SyncScreen} />
            <Stack.Screen name="UnregisteredTag" component={UnregisteredTagScreen} options={{title: 'Unregistered tag'}} />
            <Stack.Screen name="SetupWizard" component={SetupWizardScreen} options={{title: 'Machine setup'}} />
            <Stack.Screen name="Machine" component={MachineScreen} />
            <Stack.Screen name="Walkthrough" component={WalkthroughScreen} options={{headerBackVisible: false, gestureEnabled: false}} />
            <Stack.Screen name="HighSeverityFlow" component={HighSeverityFlowScreen} options={{title: 'High severity', headerBackVisible: false, gestureEnabled: false}} />
            <Stack.Screen name="Checkout" component={CheckoutScreen} options={{headerBackVisible: false, gestureEnabled: false}} />
            <Stack.Screen name="Report" component={ReportScreen} />
            <Stack.Screen name="InspectionDetail" component={InspectionDetailScreen} options={{title: 'Inspection'}} />
            <Stack.Screen name="PhotoBrowser" component={PhotoBrowserScreen} options={{title: 'Photos'}} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
