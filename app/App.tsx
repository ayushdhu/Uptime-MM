import React from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppProvider} from './src/state/AppContext';
import {RootNavigator} from './src/navigation';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <AppProvider>
        <RootNavigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}

export default App;
