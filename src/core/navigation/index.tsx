// Root Navigator - Switches between Auth, Onboarding, and Main based on state

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';

import type { RootStackParamList } from '../../types/navigation.types';
import { useAuth } from '../providers';
import { colors, typography, spacing } from '../../theme';

// Navigators
import { AuthNavigator } from './AuthNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';
import { MainNavigator } from './MainNavigator';

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function RootNavigator() {
  const { user, isLoading, isFirebaseConfigured } = useAuth();

  // Show loading while checking auth state
  if (isLoading) {
    return <LoadingScreen />;
  }

  // For demo: if Firebase not configured, show main app directly
  // In production: would show auth screens
  const showMainApp = !isFirebaseConfigured || !!user;

  // For now, skip onboarding check - we'll add it when we have user profile data
  const hasCompletedOnboarding = true;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!showMainApp ? (
          // Not authenticated - show auth screens
          <Stack.Screen name="Auth" component={AuthNavigator} />
        ) : !hasCompletedOnboarding ? (
          // Authenticated but needs to select language
          <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        ) : (
          // Fully onboarded or demo mode - show main app
          <Stack.Screen name="Main" component={MainNavigator} />
        )}
      </Stack.Navigator>
      {!isFirebaseConfigured && (
        <View style={styles.demoBanner}>
          <Text style={styles.demoBannerText}>Demo Mode - Firebase not configured</Text>
        </View>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  demoBanner: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    backgroundColor: colors.warning,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  demoBannerText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '600',
  },
});
