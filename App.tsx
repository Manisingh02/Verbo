// Verbo - Language Learning App
// Main entry point

import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

import { AppProviders } from './src/core/providers';
import { RootNavigator } from './src/core/navigation';

export default function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <AppProviders>
        <RootNavigator />
        <StatusBar style="auto" />
      </AppProviders>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
